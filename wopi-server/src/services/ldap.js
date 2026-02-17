const ldap = require('ldapjs');
const logger = require('../utils/logger');

// Enable LDAP debug logging if DEBUG_LDAP is set
const DEBUG_LDAP = process.env.DEBUG_LDAP === 'true';

function ldapDebug(message, data = {}) {
  if (DEBUG_LDAP) {
    logger.info(`[LDAP DEBUG] ${message}`, data);
  }
}

/**
 * Strip surrounding quotes from environment variable values.
 * Docker/shell sometimes passes values with quotes included.
 * Also handles escaped quotes and trims whitespace.
 */
function stripQuotes(val) {
  if (!val) return val;
  
  // Trim whitespace first
  let result = val.trim();
  
  // Remove surrounding single or double quotes
  if ((result.startsWith("'") && result.endsWith("'")) ||
      (result.startsWith('"') && result.endsWith('"'))) {
    result = result.slice(1, -1);
  }
  
  // Handle escaped quotes that might be left over
  result = result.replace(/\\"/g, '"').replace(/\\'/g, "'");
  
  // Log if there were quotes stripped (helps debug .env issues)
  if (result !== val && DEBUG_LDAP) {
    console.log(`[LDAP DEBUG] stripQuotes: "${val}" -> "${result}"`);
  }
  
  return result;
}

/**
 * LDAP Authentication Service
 * Supports: IBM Domino LDAP, Active Directory, OpenLDAP, 389 Directory, and others
 *
 * Domino LDAP specifics:
 *  - Flat directory structure: users live directly under o=OrgName
 *  - No ou=users container by default
 *  - User objectclass: dominoPerson / inetOrgPerson
 *  - Common attributes: cn, shortName, mail, mailDomain, dominoAccessGroups
 *  - Bind DN format: cn=FirstName LastName/o=OrgName  (note the slash)
 *  - User DN format: cn=FirstName LastName,o=OrgName
 */
class LDAPService {
  constructor() {
    // Server type first so we can use it for defaults
    const serverType = (stripQuotes(process.env.LDAP_SERVER_TYPE) || 'auto').toLowerCase();
    const baseDN = stripQuotes(process.env.LDAP_BASE_DN) || 'dc=example,dc=com';

    // Detect Domino early so we can set correct defaults
    const isDominoDetected = serverType === 'domino' ||
      (serverType === 'auto' && /^o=/i.test(baseDN) && !/dc=/i.test(baseDN));

    this.config = {
      url: this._sanitizeURL(stripQuotes(process.env.LDAP_URL) || 'ldap://localhost:389'),
      baseDN: baseDN.trim(),
      bindDN: stripQuotes(process.env.LDAP_BIND_DN) || '',
      bindPassword: stripQuotes(process.env.LDAP_BIND_PASSWORD) || '',
      userSearchBase: stripQuotes(process.env.LDAP_USER_SEARCH_BASE) || '',
      // Domino default filter searches by mail, cn, and shortName
      // Standard default uses uid
      userSearchFilter: stripQuotes(process.env.LDAP_USER_SEARCH_FILTER) ||
        (isDominoDetected
          ? '(|(mail={{username}})(cn={{username}})(shortName={{username}}))'
          : '(uid={{username}})'),
      groupSearchBase: stripQuotes(process.env.LDAP_GROUP_SEARCH_BASE) || '',
      groupSearchFilter: stripQuotes(process.env.LDAP_GROUP_SEARCH_FILTER) || '(member={{dn}})',
      // Domino uses cn as the primary username attribute
      usernameAttribute: stripQuotes(process.env.LDAP_USERNAME_ATTR) ||
        (isDominoDetected ? 'cn' : 'uid'),
      emailAttribute: stripQuotes(process.env.LDAP_EMAIL_ATTR) || 'mail',
      displayNameAttribute: stripQuotes(process.env.LDAP_DISPLAY_NAME_ATTR) || 'cn',
      adminGroup: stripQuotes(process.env.LDAP_ADMIN_GROUP) || 'cn=admins',
      serverType: isDominoDetected ? 'domino' : serverType,
      tlsOptions: {
        rejectUnauthorized: process.env.LDAP_TLS_REJECT_UNAUTHORIZED !== 'false'
      },
      timeout: parseInt(process.env.LDAP_TIMEOUT) || 15000,
      connectTimeout: parseInt(process.env.LDAP_CONNECT_TIMEOUT) || 15000,
      idleTimeout: parseInt(process.env.LDAP_IDLE_TIMEOUT) || 30000,
      // Domino-specific: allow searching by multiple fields
      searchByEmail: process.env.LDAP_SEARCH_BY_EMAIL === 'true',
      // Paged results (some servers need this off)
      pagedResults: process.env.LDAP_PAGED_RESULTS !== 'false'
    };

    if (isDominoDetected && serverType === 'auto') {
      ldapDebug('Auto-detected Domino LDAP from baseDN pattern');
    }

    // Validate and warn about common Domino misconfigurations
    this._validateDominoConfig();

    this._logConfig();
  }

  /**
   * Sanitize LDAP URL: trim whitespace, remove trailing slashes,
   * ensure scheme is present, add default port if missing.
   * Domino LDAP commonly runs on port 389 (LDAP) or 636 (LDAPS).
   */
  _sanitizeURL(url) {
    if (!url) return 'ldap://localhost:389';

    let sanitized = url.trim();

    // Remove trailing slashes
    sanitized = sanitized.replace(/\/+$/, '');

    // Ensure scheme is present
    if (!sanitized.match(/^ldaps?:\/\//i)) {
      // If it starts with a hostname/IP, prepend ldap://
      sanitized = `ldap://${sanitized}`;
      ldapDebug('Added ldap:// scheme to URL', { original: url, sanitized });
    }

    // Ensure port is present
    // Match scheme://host without :port
    const portMatch = sanitized.match(/^(ldaps?:\/\/[^:]+)$/);
    if (portMatch) {
      const defaultPort = sanitized.startsWith('ldaps://') ? '636' : '389';
      sanitized = `${sanitized}:${defaultPort}`;
      ldapDebug('Added default port to URL', { original: url, sanitized, defaultPort });
    }

    return sanitized;
  }

  /**
   * Validate Domino-specific configuration and warn about common issues
   */
  _validateDominoConfig() {
    if (this.config.serverType !== 'domino') return;

    // Warn if userSearchBase is set (Domino usually doesn't use it)
    if (this.config.userSearchBase && this.config.userSearchBase.trim()) {
      logger.warn('Domino LDAP: LDAP_USER_SEARCH_BASE is set. Domino usually has users directly under the org. Consider leaving it empty.', {
        userSearchBase: this.config.userSearchBase,
        baseDN: this.config.baseDN
      });
    }

    // Warn if baseDN doesn't start with o=
    if (!/^o=/i.test(this.config.baseDN)) {
      logger.warn('Domino LDAP: LDAP_BASE_DN does not start with o=. Domino typically uses o=OrgName format.', {
        baseDN: this.config.baseDN
      });
    }

    // Warn if filter uses uid (Domino doesn't have uid by default)
    if (this.config.userSearchFilter.includes('(uid=') && !this.config.userSearchFilter.includes('shortName')) {
      logger.warn('Domino LDAP: Filter uses uid attribute which Domino may not have. Consider using cn, mail, or shortName instead.', {
        filter: this.config.userSearchFilter
      });
    }

    ldapDebug('Domino config validation complete');
  }

  _logConfig() {
    const safeConfig = {
      url: this.config.url,
      baseDN: this.config.baseDN,
      bindDN: this.config.bindDN ? `${this.config.bindDN.substring(0, 10)}...` : '(anonymous)',
      userSearchBase: this.config.userSearchBase || '(baseDN)',
      userSearchFilter: this.config.userSearchFilter,
      usernameAttribute: this.config.usernameAttribute,
      emailAttribute: this.config.emailAttribute,
      serverType: this.config.serverType,
      searchByEmail: this.config.searchByEmail,
      timeout: this.config.timeout
    };
    ldapDebug('LDAP Service initialized', safeConfig);
    logger.info('LDAP Service configured', { 
      url: this.config.url, 
      serverType: this.config.serverType,
      baseDN: this.config.baseDN 
    });
  }

  /**
   * Create LDAP client connection with proper error handling
   */
  createClient() {
    const clientOptions = {
      url: this.config.url,
      timeout: this.config.timeout,
      connectTimeout: this.config.connectTimeout,
      idleTimeout: this.config.idleTimeout,
      reconnect: false,
      strictDN: false // Lenient DN parsing for Domino compatibility
    };

    if (this.config.url.startsWith('ldaps://')) {
      clientOptions.tlsOptions = this.config.tlsOptions;
      ldapDebug('Using LDAPS with TLS options', { 
        rejectUnauthorized: this.config.tlsOptions.rejectUnauthorized 
      });
    }

    ldapDebug('Creating LDAP client', { url: this.config.url });

    const client = ldap.createClient(clientOptions);

    client.on('error', (err) => {
      ldapDebug('LDAP client error event', { error: err.message, code: err.code });
      logger.error('LDAP client error', { error: err.message, code: err.code });
    });

    client.on('connectError', (err) => {
      ldapDebug('LDAP connect error', { error: err.message, code: err.code });
      logger.error('LDAP connect error', { error: err.message, code: err.code });
    });

    client.on('connect', () => {
      ldapDebug('LDAP TCP connection established');
    });

    client.on('timeout', () => {
      ldapDebug('LDAP client timeout');
      logger.warn('LDAP client timeout');
    });

    client.on('end', () => {
      ldapDebug('LDAP client connection ended');
    });

    return client;
  }

  /**
   * Bind to LDAP server with service account
   */
  async serviceBind(client) {
    return new Promise((resolve, reject) => {
      if (!this.config.bindDN) {
        ldapDebug('Using anonymous bind (no bindDN configured)');
        resolve();
        return;
      }

      // For Domino, the bind DN might use slash notation (cn=User/o=Org)
      // Convert to comma notation if needed (cn=User,o=Org)
      let bindDN = this.config.bindDN;
      if (this.config.serverType === 'domino' && bindDN.includes('/') && !bindDN.includes(',')) {
        bindDN = bindDN.replace(/\//g, ',');
        ldapDebug('Converted Domino slash DN to comma DN', { original: this.config.bindDN, converted: bindDN });
      }

      ldapDebug('Attempting service bind', { bindDN });

      client.bind(bindDN, this.config.bindPassword, (err) => {
        if (err) {
          const errInfo = {
            error: err.message,
            code: err.code,
            name: err.name,
            bindDN
          };
          ldapDebug('Service bind FAILED', errInfo);
          logger.error('LDAP service bind failed', errInfo);
          reject(new Error(`LDAP service bind failed: ${err.message} (code: ${err.code || 'unknown'})`));
        } else {
          ldapDebug('Service bind successful');
          resolve();
        }
      });
    });
  }

  /**
   * Build the search base DN
   */
  _buildSearchBase() {
    const userSearchBase = this.config.userSearchBase?.trim();

    if (!userSearchBase) {
      // No userSearchBase: search from baseDN directly (common for Domino)
      ldapDebug('Using baseDN as search base', { baseDN: this.config.baseDN });
      return this.config.baseDN;
    }

    // If userSearchBase is already a full DN (contains =), use it directly
    if (userSearchBase.includes('=')) {
      ldapDebug('Using full DN userSearchBase', { userSearchBase });
      return userSearchBase;
    }

    // Relative path: append to baseDN
    const searchBase = `${userSearchBase},${this.config.baseDN}`;
    ldapDebug('Built relative search base', { userSearchBase, baseDN: this.config.baseDN, result: searchBase });
    return searchBase;
  }

  /**
   * Sanitize LDAP filter - remove invalid characters and fix common issues.
   */
  _sanitizeFilter(filter) {
    if (!filter) return filter;
    
    let sanitized = filter;
    
    // Remove any trailing/leading whitespace
    sanitized = sanitized.trim();
    
    // Remove any stray curly braces that shouldn't be in LDAP filters
    // (leftover from {{username}} placeholder if malformed)
    sanitized = sanitized.replace(/\{+/g, '').replace(/\}+/g, '');
    
    // Remove any trailing characters that aren't valid filter endings
    // Valid LDAP filter must end with )
    while (sanitized.length > 0 && !sanitized.endsWith(')')) {
      sanitized = sanitized.slice(0, -1);
    }
    
    // Balance parentheses by removing extras from the end
    let opens = (sanitized.match(/\(/g) || []).length;
    let closes = (sanitized.match(/\)/g) || []).length;
    
    while (closes > opens && sanitized.endsWith(')')) {
      sanitized = sanitized.slice(0, -1);
      closes--;
    }
    
    // If still unbalanced (more opens than closes), add closing parens
    while (opens > closes) {
      sanitized = sanitized + ')';
      closes++;
    }
    
    return sanitized;
  }

  /**
   * Build the LDAP search filter, replacing username placeholder.
   * Supports multiple placeholder formats: {{username}}, {username}, %s, $username
   *
   * Domino LDAP specifics:
   *  - Does NOT have a 'uid' attribute by default
   *  - Users are identified by: cn (common name), mail, shortName, or internetAddress
   *  - objectClass is typically 'dominoPerson' or 'person'
   *  - Filters are case-insensitive on Domino
   *  - Domino supports standard LDAP filter syntax (RFC 4515)
   */
  _buildFilter(username) {
    // Log the raw filter from environment for debugging
    ldapDebug('Raw filter from config', { 
      rawFilter: this.config.userSearchFilter,
      rawEnvValue: process.env.LDAP_USER_SEARCH_FILTER,
      username: username
    });
    
    const escapedUsername = this.escapeLDAPFilter(username);
    let filter = this.config.userSearchFilter;
    
    // Support multiple placeholder formats
    filter = filter.replace(/\{\{username\}\}/gi, escapedUsername);  // {{username}}
    filter = filter.replace(/\{username\}/gi, escapedUsername);       // {username}
    filter = filter.replace(/%s/g, escapedUsername);                  // %s
    filter = filter.replace(/\$username/gi, escapedUsername);         // $username
    
    // If filter still contains a lone * as the value (wildcard), replace with username
    // This handles filters like (uid=*) which should be (uid=actualuser)
    if (filter.includes('=*)') || filter.includes('= *)')) {
      logger.warn('LDAP filter contains wildcard (*) - replacing with username', {
        originalFilter: filter,
        username: escapedUsername
      });
      filter = filter.replace(/=\s*\*\)/g, `=${escapedUsername})`);
    }

    // Sanitize the filter - remove invalid chars, balance parens
    filter = this._sanitizeFilter(filter);

    // Ensure the filter is wrapped in parentheses
    if (!filter.startsWith('(')) {
      filter = `(${filter})`;
      ldapDebug('Wrapped filter in parentheses', { filter });
    }

    // Final validation
    const opens = (filter.match(/\(/g) || []).length;
    const closes = (filter.match(/\)/g) || []).length;
    if (opens !== closes) {
      logger.error('LDAP filter STILL has unbalanced parentheses after sanitization', {
        filter,
        openParens: opens,
        closeParens: closes,
        rawFilter: this.config.userSearchFilter
      });
    }

    ldapDebug('Filter built', {
      raw: this.config.userSearchFilter,
      final: filter,
      username: escapedUsername,
      serverType: this.config.serverType
    });
    return filter;
  }

  /**
   * Get the list of LDAP attributes to request.
   * Includes server-type-specific attributes.
   */
  _getSearchAttributes() {
    const base = [
      this.config.usernameAttribute,
      this.config.emailAttribute,
      this.config.displayNameAttribute,
      'dn',
      'objectClass',
      'memberOf'
    ];

    // Domino-specific attributes
    const domino = [
      'dominoAccessGroups',
      'mailDomain',
      'shortName',
      'HTTPPassword',
      'fullName',
      'altFullName',
      'internetAddress'
    ];

    // Active Directory attributes
    const ad = [
      'sAMAccountName',
      'userPrincipalName',
      'displayName',
      'memberOf'
    ];

    // Common attributes
    const common = [
      'uid', 'mail', 'cn', 'givenName', 'sn'
    ];

    // Deduplicate
    const all = [...new Set([...base, ...domino, ...ad, ...common])];
    return all;
  }

  /**
   * Search for user in LDAP directory
   */
  async searchUser(client, username) {
    return new Promise((resolve, reject) => {
      const searchBase = this._buildSearchBase();
      const filter = this._buildFilter(username);
      const attributes = this._getSearchAttributes();

      const opts = {
        filter,
        scope: 'sub',
        attributes,
        sizeLimit: 5, // Allow a few results for debugging
        timeLimit: 15
      };

      ldapDebug('=== LDAP Search ===', { searchBase, filter });

      client.search(searchBase, opts, (err, res) => {
        if (err) {
          ldapDebug('Search initiation failed', { error: err.message, code: err.code, searchBase });
          reject(this._enhanceError(err, searchBase));
          return;
        }

        let user = null;
        let entriesFound = 0;

        res.on('searchEntry', (entry) => {
          entriesFound++;
          ldapDebug(`Search entry #${entriesFound}`, {
            dn: entry.objectName,
            attributes: entry.attributes.map(a => ({
              type: a.type,
              values: a.type.toLowerCase().includes('password') ? ['***'] : a.values
            }))
          });

          // Only use the first entry
          if (entriesFound === 1) {
            user = this._parseEntry(entry, username);
          }
        });

        res.on('searchReference', (referral) => {
          ldapDebug('Search referral', { uris: referral.uris });
        });

        res.on('error', (err) => {
          ldapDebug('Search error', { error: err.message, code: err.code, searchBase });
          reject(this._enhanceError(err, searchBase));
        });

        res.on('end', (result) => {
          ldapDebug('Search completed', {
            status: result?.status,
            entriesFound,
            userFound: !!user
          });

          if (entriesFound > 1) {
            logger.warn('LDAP search returned multiple entries, using first', { username, entriesFound });
          }

          resolve(user);
        });
      });
    });
  }

  /**
   * Parse an LDAP search entry into a normalized user object.
   * Handles Domino, AD, and OpenLDAP attribute differences.
   */
  _parseEntry(entry, loginUsername) {
    // Case-insensitive attribute getter
    const getAttr = (name) => {
      const attr = entry.attributes.find(a => a.type.toLowerCase() === name.toLowerCase());
      return attr?.values?.[0] || null;
    };

    const getAttrAll = (name) => {
      const attr = entry.attributes.find(a => a.type.toLowerCase() === name.toLowerCase());
      return attr?.values || [];
    };

    // Detect objectClasses to understand the entry type
    const objectClasses = getAttrAll('objectClass').map(c => c.toLowerCase());
    const isDomino = objectClasses.includes('dominoperson') || objectClasses.includes('lotusnotesperson');
    const isAD = objectClasses.includes('user') && !!getAttr('sAMAccountName');

    ldapDebug('Entry type detection', { isDomino, isAD, objectClasses });

    // Build username - try configured attribute first, then fallbacks
    let username = getAttr(this.config.usernameAttribute);
    if (!username) {
      if (isDomino) {
        username = getAttr('shortName') || getAttr('cn') || getAttr('uid');
      } else if (isAD) {
        username = getAttr('sAMAccountName') || getAttr('userPrincipalName') || getAttr('cn');
      } else {
        username = getAttr('uid') || getAttr('cn');
      }
    }

    // Build email
    let email = getAttr(this.config.emailAttribute);
    if (!email) {
      if (isDomino) {
        email = getAttr('internetAddress') || getAttr('mail');
        // Domino sometimes stores email in a different format
        if (!email) {
          const shortName = getAttr('shortName');
          const mailDomain = getAttr('mailDomain');
          if (shortName && mailDomain) {
            email = `${shortName}@${mailDomain}`;
          }
        }
      } else {
        email = getAttr('mail') || getAttr('userPrincipalName');
      }
    }

    // Build display name
    let displayName = getAttr(this.config.displayNameAttribute);
    if (!displayName) {
      displayName = getAttr('fullName') || getAttr('displayName') || getAttr('cn');
      if (!displayName) {
        const gn = getAttr('givenName');
        const sn = getAttr('sn');
        if (gn && sn) displayName = `${gn} ${sn}`;
      }
    }

    // Group membership
    const memberOf = [
      ...getAttrAll('memberOf'),
      ...getAttrAll('dominoAccessGroups')
    ];

    const user = {
      dn: entry.objectName,
      username: username || loginUsername,
      email: email || null,
      displayName: displayName || username || loginUsername,
      memberOf,
      isDomino,
      isAD,
      objectClasses
    };

    ldapDebug('Parsed user', {
      dn: user.dn,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      groupCount: user.memberOf.length,
      isDomino: user.isDomino
    });

    return user;
  }

  /**
   * Enhance LDAP errors with helpful messages
   */
  _enhanceError(err, searchBase) {
    if (err.name === 'NoSuchObjectError' || err.message.includes('No Such Object')) {
      const hint = this.config.serverType === 'domino'
        ? 'For Domino LDAP: set LDAP_USER_SEARCH_BASE to empty and LDAP_BASE_DN to your org (e.g., o=YourOrg)'
        : 'The search base DN does not exist. Check LDAP_BASE_DN and LDAP_USER_SEARCH_BASE.';
      logger.error('LDAP search base not found', { searchBase, hint });
      err.hint = hint;
    } else if (err.name === 'InvalidCredentialsError') {
      logger.error('LDAP invalid credentials', { searchBase });
      err.hint = 'Check LDAP_BIND_DN and LDAP_BIND_PASSWORD';
    } else if (err.name === 'InsufficientAccessRightsError') {
      logger.error('LDAP insufficient access', { searchBase });
      err.hint = 'The bind account does not have permission to search. Check ACLs on the LDAP server.';
    } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      logger.error('LDAP server unreachable', { url: this.config.url, code: err.code });
      err.hint = `Cannot connect to LDAP server at ${this.config.url}. Check URL and network.`;
    } else if (err.code === 'ETIMEDOUT' || err.name === 'TimeoutError') {
      logger.error('LDAP connection timeout', { url: this.config.url });
      err.hint = 'LDAP server did not respond in time. Increase LDAP_TIMEOUT or check network.';
    }
    return err;
  }

  /**
   * Escape special characters in LDAP filter values (RFC 4515)
   */
  escapeLDAPFilter(value) {
    if (!value) return '';
    return value
      .replace(/\\/g, '\\5c')
      .replace(/\*/g, '\\2a')
      .replace(/\(/g, '\\28')
      .replace(/\)/g, '\\29')
      .replace(/\x00/g, '\\00');
  }

  /**
   * Authenticate user with LDAP credentials.
   * Flow: service bind -> search user -> bind as user
   */
  async authenticate(username, password) {
    ldapDebug('========================================');
    ldapDebug('LDAP Authentication Started', { username, serverType: this.config.serverType });
    ldapDebug('========================================');

    if (!password) {
      ldapDebug('Empty password rejected');
      return null;
    }

    const client = this.createClient();
    let phase = 'init';

    try {
      // Phase 1: Service bind
      phase = 'service-bind';
      ldapDebug('Phase 1: Service bind');
      await this.serviceBind(client);

      // Phase 2: Search for user
      phase = 'user-search';
      ldapDebug('Phase 2: Search for user');
      const user = await this.searchUser(client, username);

      if (!user) {
        ldapDebug('User not found in LDAP', { username });
        logger.warn('LDAP user not found', { username });
        this.safeUnbind(client);
        return null;
      }

      // Phase 3: Bind as user to verify password
      phase = 'user-bind';
      ldapDebug('Phase 3: User bind to verify password', { dn: user.dn });

      return new Promise((resolve, reject) => {
        // For Domino, the user DN might need conversion
        let userDN = user.dn;
        if (typeof userDN === 'object' && userDN.toString) {
          userDN = userDN.toString();
        }

        ldapDebug('Binding as user', { userDN });

        client.bind(userDN, password, (err) => {
          this.safeUnbind(client);

          if (err) {
            ldapDebug('User bind FAILED', {
              username,
              error: err.message,
              code: err.code,
              name: err.name
            });
            logger.warn('LDAP authentication failed', { username, error: err.message });
            resolve(null);
          } else {
            ldapDebug('User bind SUCCESS', { username });
            logger.info('LDAP authentication successful', { username, dn: userDN });

            // Determine role
            const isAdmin = user.memberOf.some(group =>
              group.toLowerCase().includes(this.config.adminGroup.toLowerCase())
            );

            // Generate fallback email from DN if not found
            let email = user.email;
            if (!email) {
              const baseDomain = this.config.baseDN
                .replace(/o=/gi, '').replace(/dc=/gi, '').replace(/,/g, '.');
              email = `${user.username}@${baseDomain}`;
            }

            const result = {
              username: user.username,
              email,
              displayName: user.displayName,
              role: isAdmin ? 'admin' : 'user',
              ldapDN: userDN,
              groups: user.memberOf,
              serverType: this.config.serverType,
              isDomino: user.isDomino
            };

            ldapDebug('Authentication result', result);
            resolve(result);
          }
        });
      });
    } catch (error) {
      ldapDebug('LDAP authentication error', {
        phase,
        error: error.message,
        hint: error.hint,
        stack: error.stack
      });
      logger.error('LDAP authentication error', {
        phase,
        error: error.message,
        hint: error.hint
      });
      this.safeUnbind(client);
      throw error;
    }
  }

  /**
   * Safely unbind client, ignoring errors
   */
  safeUnbind(client) {
    try {
      if (client && !client.destroyed) {
        client.unbind();
      }
    } catch (e) {
      ldapDebug('Unbind error (ignored)', { error: e.message });
    }
  }

  /**
   * Get user groups from LDAP
   */
  async getUserGroups(username) {
    const client = this.createClient();
    try {
      await this.serviceBind(client);
      const user = await this.searchUser(client, username);
      this.safeUnbind(client);
      return user?.memberOf || [];
    } catch (error) {
      logger.error('LDAP get groups error', { error: error.message });
      this.safeUnbind(client);
      return [];
    }
  }

  /**
   * Check if user exists in LDAP (without password verification)
   * Used for LDAP+LTPA combined authentication
   */
  async userExistsInLDAP(username) {
    ldapDebug('Checking if user exists in LDAP', { username });
    const client = this.createClient();
    try {
      await this.serviceBind(client);
      const user = await this.searchUser(client, username);
      this.safeUnbind(client);
      const exists = !!user;
      ldapDebug('User exists check result', { username, exists });
      return exists;
    } catch (error) {
      logger.error('LDAP user check error', { error: error.message, hint: error.hint });
      this.safeUnbind(client);
      return false;
    }
  }

  /**
   * Get user details from LDAP without authentication
   */
  async getUserFromLDAP(username) {
    ldapDebug('Getting user details from LDAP', { username });
    const client = this.createClient();
    try {
      await this.serviceBind(client);
      const user = await this.searchUser(client, username);
      this.safeUnbind(client);
      if (user) {
        return {
          username: user.username,
          email: user.email,
          displayName: user.displayName,
          groups: user.memberOf,
          dn: user.dn,
          isDomino: user.isDomino
        };
      }
      return null;
    } catch (error) {
      logger.error('LDAP get user error', { error: error.message });
      this.safeUnbind(client);
      return null;
    }
  }

  /**
   * Test LDAP connection and optionally search for a test user
   */
  async testConnection(testUsername = null) {
    ldapDebug('=== LDAP Connection Test ===');
    const results = { steps: [] };
    const client = this.createClient();

    try {
      // Step 1: Bind
      results.steps.push({ step: 'connect', status: 'attempting', url: this.config.url });
      await this.serviceBind(client);
      results.steps[0].status = 'success';

      // Step 2: Search (optional)
      if (testUsername) {
        results.steps.push({ step: 'search', status: 'attempting', username: testUsername });
        const user = await this.searchUser(client, testUsername);
        results.steps[1].status = user ? 'found' : 'not_found';
        results.steps[1].user = user ? { dn: user.dn, email: user.email } : null;
      }

      this.safeUnbind(client);
      return { success: true, message: 'LDAP connection successful', ...results };
    } catch (error) {
      this.safeUnbind(client);
      return {
        success: false,
        message: error.message,
        hint: error.hint,
        ...results
      };
    }
  }
}

module.exports = new LDAPService();
