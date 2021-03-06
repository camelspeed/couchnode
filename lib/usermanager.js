'use strict';

const PromiseHelper = require('./promisehelper');
const HttpExecutor = require('./httpexecutor');
const errors = require('./errors');
const qs = require('qs');

/**
 * Origin represents a server-side origin information
 *
 * @category Management
 */
class Origin {
  constructor() {
    this.type = '';
    this.name = undefined;
  }

  _fromData(data) {
    this.type = data.type;
    this.name = data.name;

    return this;
  }
}

/**
 * Role represents a server-side role object
 *
 * @category Management
 */
class Role {
  constructor() {
    this.name = '';
    this.bucket = undefined;
  }

  _fromData(data) {
    this.name = data.role;
    this.bucket = data.bucket_name;

    return this;
  }

  static _toStrData(role) {
    if (typeof role === 'string') {
      return role;
    }

    if (role.bucket) {
      return `${role.name}[${role.bucket}]`;
    } else {
      return role.name;
    }
  }
}

/**
 * RoleAndDescription represents a server-side role object
 * along with description information.
 *
 * @category Management
 */
class RoleAndDescription extends Role {
  constructor() {
    super();

    this.displayName = '';
    this.description = '';
  }

  _fromData(data) {
    super._fromData(data);

    this.displayName = data.name;
    this.description = data.description;

    return this;
  }
}

/**
 * RoleAndOrigin represents a server-side role object along
 * with the origin information which goes with the role.
 *
 * @category Management
 */
class RoleAndOrigin extends Role {
  constructor() {
    super();

    this.origins = [];
  }

  _fromData(data) {
    super._fromData(data);

    this.origins = [];
    data.origins.forEach((originData) => {
      this.origins.push(new Origin()._fromData(originData));
    });

    return this;
  }

  _hasUserOrigin() {
    if (this.origins.length === 0) {
      return true;
    }

    for (var i = 0; i < this.origins.length; ++i) {
      if (this.origins[i].type === 'user') {
        return true;
      }
    }
    return false;
  }
}

/**
 * User represents a server-side user object.
 *
 * @category Management
 */
class User {
  constructor() {
    this.username = '';
    this.displayName = '';
    this.groups = [];
    this.roles = [];
    this.password = '';
  }

  _fromData(data) {
    this.username = data.id;
    this.displayName = data.name;
    this.groups = data.groups;
    this.roles = [];
    data.roles.forEach((roleData) => {
      var role = new RoleAndOrigin()._fromData(roleData);
      if (role._hasUserOrigin()) {
        this.roles.push(new Role()._fromData(roleData));
      }
    });

    return this;
  }

  static _toData(user) {
    var jsonData = {};
    jsonData.name = user.displayName;
    if (user.groups && user.groups.length > 0) {
      jsonData.groups = user.groups;
    }
    if (user.password) {
      jsonData.password = user.password;
    }
    return jsonData;
  }
}

/**
 * UserAndMetadata represents a server-side user object with its
 * metadata information included.
 *
 * @category Management
 */
class UserAndMetadata extends User {
  constructor() {
    super();

    this.domain = '';
    this.effectiveRoles = [];
    this.effectiveRolesAndOrigins = [];
    this.passwordChanged = null;
    this.externalGroups = [];
  }

  _fromData(data) {
    super._fromData(data);

    this.domain = data.domain;
    this.effectiveRoles = [];
    data.roles.forEach((roleData) => {
      this.effectiveRoles.push(new Role()._fromData(roleData));
    });
    this.effectiveRolesAndOrigins = [];
    data.roles.forEach((roleData) => {
      this.effectiveRolesAndOrigins.push(
        new RoleAndOrigin()._fromData(roleData)
      );
    });
    this.passwordChanged = new Date(data.password_change_date);
    this.externalGroups = data.external_groups;

    return this;
  }

  user() {
    return User._fromData(this._userData);
  }
}

/**
 * Group represents a server Group object.
 *
 * @category Management
 */
class Group {
  constructor() {
    this.name = '';
    this.description = '';
    this.roles = [];
    this.ldapGroupReference = undefined;
  }

  _fromData(data) {
    this.name = data.id;
    this.description = data.description;
    this.roles = [];
    data.roles.forEach((roleData) => {
      this.roles.push(new Role()._fromData(roleData));
    });
    this.ldap_group_reference = data.ldapGroupReference;

    return this;
  }

  static _toData(group) {
    var jsonData = {};
    jsonData.description = group.description;
    if (group.roles) {
      jsonData.roles = group.roles.map((role) => Role._toStrData(role));
    } else {
      jsonData.roles = [];
    }
    if (group.ldapGroupReference) {
      jsonData.ldapGroupReference = group.ldapGroupReference;
    }
    return jsonData;
  }
}

/**
 * UserManager is an interface which enables the management of users
 * within a cluster.
 *
 * @category Management
 */
class UserManager {
  /**
   * @hideconstructor
   */
  constructor(cluster) {
    this._cluster = cluster;
  }

  get _http() {
    return new HttpExecutor(this._cluster._getClusterConn());
  }

  /**
   * @typedef {function(Error, User)} GetUserCallback
   */
  /**
   *
   * @param {string} username
   * @param {*} [options]
   * @param {string} [options.domainName]
   * @param {integer} [options.timeout]
   * @param {GetUserCallback} [callback]
   *
   * @throws {CouchbaseError}
   * @returns {Promise<User>}
   */
  async getUser(username, options, callback) {
    if (options instanceof Function) {
      callback = arguments[1];
      options = undefined;
    }
    if (!options) {
      options = {};
    }

    return PromiseHelper.wrapAsync(async () => {
      var domainName = 'local';
      if (options.domainName) {
        domainName = options.domainName;
      }

      var res = await this._http.request({
        type: 'MGMT',
        method: 'GET',
        path: `/settings/rbac/users/${domainName}/${username}`,
        timeout: options.timeout,
      });

      if (res.statusCode !== 200) {
        var baseerr = errors.makeHttpError(res);

        if (res.statusCode === 404) {
          throw new errors.UserNotFoundError(baseerr);
        }

        throw new errors.CouchbaseError('failed to get the user', baseerr);
      }

      var userData = JSON.parse(res.body);
      return new UserAndMetadata()._fromData(userData);
    }, callback);
  }

  /**
   * @typedef {function(Error, User[])} GetAllUsersCallback
   */
  /**
   *
   * @param {*} [options]
   * @param {string} [options.domainName]
   * @param {integer} [options.timeout]
   * @param {GetAllUsersCallback} [callback]
   *
   * @throws {CouchbaseError}
   * @returns {Promise<User[]>}
   */
  async getAllUsers(options, callback) {
    if (options instanceof Function) {
      callback = arguments[0];
      options = undefined;
    }
    if (!options) {
      options = {};
    }

    return PromiseHelper.wrapAsync(async () => {
      var domainName = 'local';
      if (options.domainName) {
        domainName = options.domainName;
      }

      var res = await this._http.request({
        type: 'MGMT',
        method: 'GET',
        path: `/settings/rbac/users/${domainName}`,
        timeout: options.timeout,
      });

      if (res.statusCode !== 200) {
        throw new errors.CouchbaseError(
          'failed to get users',
          errors.makeHttpError(res)
        );
      }

      var usersData = JSON.parse(res.body);

      var users = [];
      usersData.forEach((userData) => {
        users.push(new UserAndMetadata()._fromData(userData));
      });

      return users;
    }, callback);
  }

  /**
   * @typedef {function(Error, boolean)} UpsertUserCallback
   */
  /**
   *
   * @param {User} user
   * @param {*} [options]
   * @param {string} [options.domainName]
   * @param {integer} [options.timeout]
   * @param {UpsertUserCallback} [callback]
   *
   * @throws {CouchbaseError}
   * @returns {Promise<boolean>}
   */
  async upsertUser(user, options, callback) {
    if (options instanceof Function) {
      callback = arguments[1];
      options = undefined;
    }
    if (!options) {
      options = {};
    }

    return PromiseHelper.wrapAsync(async () => {
      var domainName = 'local';
      if (options.domainName) {
        domainName = options.domainName;
      }

      var userData = User._toData(user);
      var userQs = qs.stringify(userData);

      var res = await this._http.request({
        type: 'MGMT',
        method: 'PUT',
        path: `/settings/rbac/users/${domainName}/${user.username}`,
        contentType: 'application/x-www-form-urlencoded',
        body: userQs,
        timeout: options.timeout,
      });

      if (res.statusCode !== 200) {
        throw new errors.CouchbaseError(
          'failed to upsert user',
          errors.makeHttpError(res)
        );
      }

      return true;
    }, callback);
  }

  /**
   * @typedef {function(Error, boolean)} DropUserCallback
   */
  /**
   *
   * @param {string} username
   * @param {*} [options]
   * @param {string} [options.domainName]
   * @param {integer} [options.timeout]
   * @param {DropUserCallback} [callback]

   * @throws {UserNotFoundError}
   * @throws {CouchbaseError}
   * @returns {Promise<boolean>}
   */
  async dropUser(username, options, callback) {
    if (options instanceof Function) {
      callback = arguments[1];
      options = undefined;
    }
    if (!options) {
      options = {};
    }

    return PromiseHelper.wrapAsync(async () => {
      var domainName = 'local';
      if (options.domainName) {
        domainName = options.domainName;
      }

      var res = await this._http.request({
        type: 'MGMT',
        method: 'DELETE',
        path: `/settings/rbac/users/${domainName}/${username}`,
        timeout: options.timeout,
      });

      if (res.statusCode !== 200) {
        var baseerr = errors.makeHttpError(res);

        if (res.statusCode === 404) {
          throw new errors.UserNotFoundError(baseerr);
        }

        throw new errors.CouchbaseError('failed to drop the user', baseerr);
      }

      return true;
    }, callback);
  }

  /**
   * @typedef {function(Error, RoleAndDescription[])} GetRolesCallback
   */
  /**
   *
   * @param {*} [options]
   * @param {integer} [options.timeout]
   * @param {GetRolesCallback} [callback]
   *
   * @throws {CouchbaseError}
   * @returns {Promise<RoleAndDescription[]>}
   */
  async getRoles(options, callback) {
    if (options instanceof Function) {
      callback = arguments[1];
      options = undefined;
    }
    if (!options) {
      options = {};
    }

    return PromiseHelper.wrapAsync(async () => {
      var res = await this._http.request({
        type: 'MGMT',
        method: 'GET',
        path: `/settings/rbac/roles`,
        timeout: options.timeout,
      });

      if (res.statusCode !== 200) {
        throw new errors.CouchbaseError(
          'failed to get roles',
          errors.makeHttpError(res)
        );
      }

      var rolesData = JSON.parse(res.body);
      var roles = [];
      rolesData.forEach((roleData) => {
        roles.push(new RoleAndDescription()._fromData(roleData));
      });

      return roles;
    }, callback);
  }

  /**
   * @typedef {function(Error, Group)} GetGroupCallback
   */
  /**
   *
   * @param {string} groupName
   * @param {*} [options]
   * @param {integer} [options.timeout]
   * @param {GetGroupCallback} [callback]
   *
   * @throws {GroupNotFoundError}
   * @throws {CouchbaseError}
   * @returns {Promise<Group>}
   */
  async getGroup(groupName, options, callback) {
    if (options instanceof Function) {
      callback = arguments[1];
      options = undefined;
    }
    if (!options) {
      options = {};
    }

    return PromiseHelper.wrapAsync(async () => {
      var res = await this._http.request({
        type: 'MGMT',
        method: 'GET',
        path: `/settings/rbac/groups/${groupName}`,
        timeout: options.timeout,
      });

      if (res.statusCode !== 200) {
        var baseerr = errors.makeHttpError(res);

        if (res.statusCode === 404) {
          throw new errors.GroupNotFoundError(baseerr);
        }

        throw new errors.CouchbaseError('failed to get the group', baseerr);
      }

      var groupData = JSON.parse(res.body);
      return new Group()._fromData(groupData);
    }, callback);
  }

  /**
   * @typedef {function(Error, Group[])} GetAllGroupsCallback
   */
  /**
   *
   * @param {*} [options]
   * @param {integer} [options.timeout]
   * @param {GetAllGroupsCallback} [callback]
   *
   * @throws {CouchbaseError}
   * @returns {Promise<Group[]>}
   */
  async getAllGroups(options, callback) {
    if (options instanceof Function) {
      callback = arguments[0];
      options = undefined;
    }
    if (!options) {
      options = {};
    }

    return PromiseHelper.wrapAsync(async () => {
      var res = await this._http.request({
        type: 'MGMT',
        method: 'GET',
        path: `/settings/rbac/groups`,
        timeout: options.timeout,
      });

      if (res.statusCode !== 200) {
        throw new errors.CouchbaseError(
          'failed to get groups',
          errors.makeHttpError(res)
        );
      }

      var groupsData = JSON.parse(res.body);

      var groups = [];
      groupsData.forEach((groupData) => {
        groups.push(new Group()._fromData(groupData));
      });

      return groups;
    }, callback);
  }

  /**
   * @typedef {function(Error, boolean)} UpsertGroupCallback
   */
  /**
   *
   * @param {Group} group
   * @param {*} [options]
   * @param {integer} [options.timeout]
   * @param {UpsertGroupCallback} [callback]
   *
   * @throws {CouchbaseError}
   * @returns {Promise<boolean>}
   */
  async upsertGroup(group, options, callback) {
    if (options instanceof Function) {
      callback = arguments[1];
      options = undefined;
    }
    if (!options) {
      options = {};
    }

    return PromiseHelper.wrapAsync(async () => {
      var groupData = Group._toData(group);
      groupData.roles = groupData.roles.join(',');
      var groupQs = qs.stringify(groupData);

      var res = await this._http.request({
        type: 'MGMT',
        method: 'PUT',
        path: `/settings/rbac/groups/${group.name}`,
        contentType: 'application/x-www-form-urlencoded',
        body: groupQs,
        timeout: options.timeout,
      });

      if (res.statusCode !== 200) {
        throw new errors.CouchbaseError(
          'failed to upsert group',
          errors.makeHttpError(res)
        );
      }

      return true;
    }, callback);
  }

  /**
   * @typedef {function(Error, boolean)} DropGroupCallback
   */
  /**
   *
   * @param {string} username
   * @param {*} [options]
   * @param {integer} [options.timeout]
   * @param {DropGroupCallback} [callback]
   *
   * @throws {CouchbaseError}
   * @returns {Promise<boolean>}
   */
  async dropGroup(groupName, options, callback) {
    if (options instanceof Function) {
      callback = arguments[1];
      options = undefined;
    }
    if (!options) {
      options = {};
    }

    return PromiseHelper.wrapAsync(async () => {
      var res = await this._http.request({
        type: 'MGMT',
        method: 'DELETE',
        path: `/settings/rbac/groups/${groupName}`,
        timeout: options.timeout,
      });

      if (res.statusCode !== 200) {
        var baseerr = errors.makeHttpError(res);

        if (res.statusCode === 404) {
          throw new errors.GroupNotFoundError(baseerr);
        }

        throw new errors.CouchbaseError('failed to drop the group', baseerr);
      }

      return true;
    }, callback);
  }
}
module.exports = UserManager;
