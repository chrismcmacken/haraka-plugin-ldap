'use strict';

/**
 * authn_ldap.js
 * This haraka module implements authentication agains LDAP servers,
 * i.e. it checks if the given user credentials are valid in LDAP.
 */


exports._verify_user = function (userdn, passwd, cb) {
    var plugin = this;
    if (!this.pool) {
        plugin.logerror('Could not verify userdn and password: LDAP Pool not found!');
        return cb(false);
    }
    this.pool._create_client(function (err, client) {
        if (err) {
            plugin.logdebug("Login failed, could not get connection: " + err);
            return cb(false);
        }
        client.bind(userdn, passwd, function(err) {
            if (err) {
                plugin.logdebug("Login failed, could not bind '" + userdn + "': " + err);
                return cb(false);
            }
            else {
                client.unbind();
                return cb(true);
            }
        });
    });
};

exports._get_search_conf = function(user) {
    var plugin = this;
    var filter = plugin.cfg.main.filter || '(&(objectclass=*)(uid=%u))';
    filter = filter.replace(/%u/g, user);
    var config = {
        basedn: this.pool.config.basedn,
        filter: filter,
        scope: plugin.cfg.main.scope || 'sub',
        attributes: ['dn', plugin.cfg.main.mail_attribute || 'mail']
    };
    if (config.basedn === undefined) {
        plugin.logerror("Undefined basedn. Please check your configuration!");
    }
    return config;
};

exports._get_dn_for_uid = function (uid, callback) {
    var plugin = this;
    var onError = function(err) {
        plugin.logerror('Could not get DN for UID "' + uid + '": ' +  err);
        callback(err);
    };
    if (!this.pool) {
        return onError('LDAP Pool not found!');
    }
    var dnSearch = function (err, client) {
        var config = plugin._get_search_conf(uid);
        if (err) {
            return onError(err);
        }
        else {
            try {
                client.search(config.basedn, config, function(search_error, res) {
                    if (search_error) { onError(search_error); }
                    var userdn=[];
                    res.on('searchEntry', function(entry) {
                        userdn.push(entry.object.dn);
                    });
                    res.on('error', onError);
                    res.on('end', function() {
                        return callback(null, userdn);
                    });
                });
            }
            catch (e) {
                return onError(e);
            }
        }
    };
    this.pool.get(dnSearch);
};

exports.hook_capabilities = function (next, connection) {
    // Don't offer AUTH capabilities by default unless session is encrypted
    if (connection.using_tls) {
        var methods = [ 'PLAIN', 'LOGIN' ];
        connection.capabilities.push('AUTH ' + methods.join(' '));
        connection.notes.allowed_auth_methods = methods;
    }
    next();
};

exports.register = function() {
    this.inherits('auth/auth_base');
    var plugin = this;
    plugin.register_hook('init_master',  'init_authn_ldap');
    plugin.register_hook('init_child',   'init_authn_ldap');
    var load_authn_ldap_ini = function() {
        plugin.loginfo("loading authn_ldap.ini");
        plugin.cfg = plugin.config.get('authn_ldap.ini', 'ini', load_authn_ldap_ini);
    };
    load_authn_ldap_ini();
};

exports.init_authn_ldap = function(next, server) {
    var plugin = this;
    if (!server.notes.ldappool) {
        plugin.logerror('LDAP Pool not found! Make sure ldappool plugin is loaded!');
    }
    else {
        this.pool = server.notes.ldappool;
    }
    next();
};

exports.check_plain_passwd = function (connection, user, passwd, cb) {
    var plugin = this;
    var errWhileCheck = function(err) {
        plugin.logerror("Could not use LDAP for password check: " + err);
        return cb(false);
    };
    plugin._get_dn_for_uid(user, function(err, userdn) {
        if (err) {
            errWhileCheck(err);
        }
        else if (userdn.length !== 1) {
            plugin.logdebug('None or nonunique LDAP search result for user, access denied');
            return cb(false);
        }
        else {
            plugin._verify_user(userdn[0], passwd, cb);
        }
    });
};
