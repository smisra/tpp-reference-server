const assert = require('assert');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

const {
  setConsent,
  consent,
  consentAccessToken,
  consentAccessTokenAndPermissions,
  consentAccountRequestId,
  deleteConsent,
  getConsent,
} = require('../../app/authorise');
const { AUTH_SERVER_USER_CONSENTS_COLLECTION } = require('../../app/authorise/consents');

const { drop } = require('../../app/storage.js');

const username = 'testUsername';
const sessionId = 'testSessionId';
const authorisationServerId = 'a123';
const scope = 'accounts';
const keys = { username, authorisationServerId, scope };

const accountRequestId = 'xxxxxx-xxxx-43c6-9c75-eaf01821375e';
const authorisationCode = 'spoofAuthCode';
const token = 'testAccessToken';
const tokenPayload = {
  access_token: token,
  expires_in: 3600,
  token_type: 'bearer',
};
const permissions = ['ReadAccountsDetail'];

const accountRequestPayload = {
  username,
  authorisationServerId,
  scope,
  accountRequestId,
  permissions,
};

const consentPayload = {
  username,
  authorisationServerId,
  scope,
  accountRequestId,
  expirationDateTime: null,
  authorisationCode,
  token: tokenPayload,
};

const consentStatus = 'Authorised';

describe('setConsents', () => {
  beforeEach(async () => {
    await drop(AUTH_SERVER_USER_CONSENTS_COLLECTION);
  });

  afterEach(async () => {
    await drop(AUTH_SERVER_USER_CONSENTS_COLLECTION);
  });

  it('stores account request payload and allows to be retrieved', async () => {
    await setConsent(keys, accountRequestPayload);
    const stored = await consent(keys);
    assert.equal(stored.id, `${username}:::${authorisationServerId}:::${scope}`);
  });

  it('stores consent payload, keeping permissions from stored account request with same accountRequestId', async () => {
    await setConsent(keys, accountRequestPayload);
    await setConsent(keys, consentPayload);
    const stored = await consent(keys);
    assert.deepEqual(stored.permissions, accountRequestPayload.permissions);
  });

  it('stores consent payload, without permissions from stored account request with different accountRequestId', async () => {
    const accountRequestWithDifferentId = Object.assign({}, accountRequestPayload, { accountRequestId: 'differentId' });
    await setConsent(keys, accountRequestWithDifferentId);
    await setConsent(keys, consentPayload);
    const stored = await consent(keys);
    assert.equal(stored.permissions, null);
  });

  it('stores payload and allows consent access_token to be retrieved', async () => {
    await setConsent(keys, consentPayload);
    const storedAccessToken = await consentAccessToken(keys);
    assert.equal(storedAccessToken, token);
  });

  it('stores payload and allows consent access_token and permissions to be retrieved', async () => {
    await setConsent(keys, accountRequestPayload);
    await setConsent(keys, consentPayload);
    const data = await consentAccessTokenAndPermissions(keys);
    assert.equal(data.accessToken, token);
    assert.deepEqual(data.permissions, permissions);
  });

  it('stores payload and allows consent accountRequestId to be retrieved', async () => {
    await setConsent(keys, consentPayload);
    const storedAccountRequestId = await consentAccountRequestId(keys);
    assert.equal(storedAccountRequestId, accountRequestId);
  });
});

describe('deleteConsent', () => {
  beforeEach(async () => {
    await drop(AUTH_SERVER_USER_CONSENTS_COLLECTION);
  });

  afterEach(async () => {
    await drop(AUTH_SERVER_USER_CONSENTS_COLLECTION);
  });

  it('stores payload and allows consent to be retrieved by keys id', async () => {
    await setConsent(keys, consentPayload);
    await deleteConsent(keys);
    const result = await getConsent(keys);
    assert.equal(result, null);
  });
});

describe('filterConsented', () => {
  const getAccountRequestStub = sinon.stub().returns({ Data: { Status: consentStatus } });
  let filterConsented;
  beforeEach(() => {
    ({ filterConsented } = proxyquire(
      '../../app/authorise/consents.js',
      {
        './setup-request': {
          accessTokenAndResourcePath: () => ({}),
        },
        '../setup-account-request/account-requests': {
          getAccountRequest: getAccountRequestStub,
        },
        '../authorisation-servers': {
          fapiFinancialIdFor: () => 'id',
        },
      },
    ));
  });

  afterEach(async () => {
    await drop(AUTH_SERVER_USER_CONSENTS_COLLECTION);
  });

  describe('given authorisationServerId with authorisationCode and authorised status', () => {
    beforeEach(async () => {
      await setConsent(keys, consentPayload);
    });

    it('returns array containing authorisationServerId', async () => {
      const consented = await filterConsented(username, scope, sessionId, [authorisationServerId]);
      assert.deepEqual(consented, [authorisationServerId]);
    });
  });

  describe('given authorisationServerId with no authorisationCode in config', () => {
    beforeEach(async () => {
      await setConsent(keys, Object.assign({}, consentPayload, { authorisationCode: null }));
    });

    it('returns empty array', async () => {
      const consented = await filterConsented(username, scope, sessionId, [authorisationServerId]);
      assert.deepEqual(consented, []);
    });
  });

  describe('given authorisationServerId with status revoked', () => {
    beforeEach(async () => {
      getAccountRequestStub.returns({ Data: { Status: 'Revoked' } });
      await setConsent(keys, Object.assign({}, consentPayload, { authorisationCode: null }));
    });

    it('returns empty array', async () => {
      const consented = await filterConsented(username, scope, sessionId, [authorisationServerId]);
      assert.deepEqual(consented, []);
    });
  });

  describe('given authorisationServerId without config', () => {
    it('returns empty array', async () => {
      const consented = await filterConsented(username, scope, sessionId, [authorisationServerId]);
      assert.deepEqual(consented, []);
    });
  });
});

describe('getConsentStatus', () => {
  const fapiFinancialId = 'testFapiFinancialId';
  const interactionId = 'testInteractionId';
  const accessToken = 'grant-credential-access-token';
  const resourcePath = 'http://resource-server.com/open-banking/v1.1';
  const getAccountRequestStub = sinon.stub();
  let getConsentStatus;

  describe('successful', () => {
    beforeEach(() => {
      getAccountRequestStub.returns({ Data: { Status: consentStatus } });
      ({ getConsentStatus } = proxyquire(
        '../../app/authorise/consents.js',
        {
          './setup-request': {
            accessTokenAndResourcePath: () => ({ accessToken, resourcePath }),
          },
          '../setup-account-request/account-requests': {
            getAccountRequest: getAccountRequestStub,
          },
          '../authorisation-servers': {
            fapiFinancialIdFor: () => fapiFinancialId,
          },
          'uuid/v4': () => interactionId,
        },
      ));
    });

    it('makes remote call to get account request', async () => {
      await getConsentStatus(accountRequestId, authorisationServerId, sessionId);
      const headers = {
        accessToken, fapiFinancialId, interactionId, sessionId, authorisationServerId,
      };
      assert(getAccountRequestStub.calledWithExactly(accountRequestId, resourcePath, headers));
    });

    it('gets the status for an existing consent', async () => {
      const actual = await getConsentStatus(accountRequestId, authorisationServerId, sessionId);
      assert.equal(actual, consentStatus);
    });
  });

  describe('errors', () => {
    it('throws error for missing payload', async () => {
      try {
        await getConsentStatus(accountRequestId, authorisationServerId, sessionId);
      } catch (err) {
        assert(err);
      }
    });

    it('throws error for missing Data payload', async () => {
      getAccountRequestStub.returns({});
      try {
        await getConsentStatus(accountRequestId, authorisationServerId, sessionId);
      } catch (err) {
        assert(err);
      }
    });
  });
});
