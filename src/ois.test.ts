import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cloneDeep } from 'lodash';

import { version as packageVersion } from '../package.json';

import {
  oisSchema,
  operationParameterSchema,
  endpointParameterSchema,
  type OIS,
  pathNameSchema,
  semverSchema,
  reservedParameterSchema,
  reservedParametersSchema,
  packageVersionCompatibleSemverSchema,
  fixedParameterSchema,
  endpointSchema,
} from './ois';

const loadOisFixture = (): OIS =>
  // This OIS is guaranteed to be valid because there is a test for it's validity below
  JSON.parse(readFileSync(join(__dirname, '../test/fixtures/ois.json')).toString());

test('successfully parses OIS spec', () => {
  const ois = loadOisFixture();
  expect(() => oisSchema.parse(ois)).not.toThrow();
});

test(`doesn't allow extraneous properties`, () => {
  const ois = loadOisFixture();
  expect(() => oisSchema.parse(ois)).not.toThrow();

  const invalidOis = { ...ois, unknownProp: 'someValue' };
  expect(oisSchema.safeParse(invalidOis).error?.issues).toStrictEqual([
    {
      code: 'unrecognized_keys',
      keys: ['unknownProp'],
      path: [],
      message: `Unrecognized key: "unknownProp"`,
    },
  ]);
});

test('handles discriminated union error nicely', () => {
  const ois = loadOisFixture();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (ois.apiSpecifications.components.securitySchemes.coinlayerSecurityScheme as any).name;

  expect(oisSchema.safeParse(ois).error?.issues).toStrictEqual([
    {
      code: 'invalid_type',
      expected: 'string',
      path: ['apiSpecifications', 'components', 'securitySchemes', 'coinlayerSecurityScheme', 'name'],
      message: 'Invalid input: expected string, received undefined',
    },
  ]);
});

describe('disallows reserved parameter name', () => {
  it('in operation parameters', () => {
    expect(operationParameterSchema.safeParse({ in: 'header', name: '_type' }).error?.issues).toStrictEqual([
      {
        code: 'custom',
        message: '"_type" cannot be used because it is a name of a reserved parameter',
        path: ['name'],
      },
    ]);
  });

  it('in parameters', () => {
    expect(
      endpointParameterSchema.safeParse({ name: 'param', operationParameter: { in: 'header', name: '_type' } }).error
        ?.issues
    ).toStrictEqual([
      {
        code: 'custom',
        message: '"_type" cannot be used because it is a name of a reserved parameter',
        path: ['operationParameter', 'name'],
      },
    ]);
  });
});

describe('parameter uniqueness', () => {
  it('allows operation parameter with same name, but different location', () => {
    const paramName = 'some-id';
    const ois = loadOisFixture();
    ois.apiSpecifications.paths['/convert'].get!.parameters.push({
      in: 'query',
      name: paramName,
    });
    ois.endpoints[0].fixedOperationParameters.push({
      operationParameter: {
        in: 'query',
        name: paramName,
      },
      value: 'query-id',
    });
    ois.apiSpecifications.paths['/convert'].get!.parameters.push({
      in: 'cookie',
      name: paramName,
    });
    ois.endpoints[0].fixedOperationParameters.push({
      operationParameter: {
        in: 'cookie',
        name: paramName,
      },
      value: 'cookie-id',
    });

    expect(() => oisSchema.parse(ois)).not.toThrow();
  });

  it(`fails if the same operation parameter is used in "parameters"`, () => {
    const ois = loadOisFixture();
    ois.endpoints[0].parameters.push({ ...ois.endpoints[0].parameters[0], name: 'different-name' });

    expect(oisSchema.safeParse(ois).error?.issues).toStrictEqual([
      {
        code: 'custom',
        message: 'Parameter "from" in "query" is used multiple times',
        path: ['endpoints', 0, 'parameters', 0],
      },
      {
        code: 'custom',
        message: 'Parameter "from" in "query" is used multiple times',
        path: ['endpoints', 0, 'parameters', 3],
      },
    ]);
  });

  it(`fails if the same operation parameter is used in "fixedOperationParameters"`, () => {
    const ois = loadOisFixture();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ois.endpoints[0].fixedOperationParameters.push(ois.endpoints[0].fixedOperationParameters[0] as any);

    expect(oisSchema.safeParse(ois).error?.issues).toStrictEqual([
      {
        code: 'custom',
        message: 'Parameter "to" in "query" is used multiple times',
        path: ['endpoints', 0, 'fixedOperationParameters', 0],
      },
      {
        code: 'custom',
        message: 'Parameter "to" in "query" is used multiple times',
        path: ['endpoints', 0, 'fixedOperationParameters', 1],
      },
    ]);
  });

  it('fails if the same operation parameter is used in both "fixedOperationParameters" and "parameters"', () => {
    const ois = loadOisFixture();
    ois.endpoints[0].fixedOperationParameters.push({
      operationParameter: ois.endpoints[0].parameters[0].operationParameter!,
      value: '123',
    });

    expect(oisSchema.safeParse(ois).error?.issues).toStrictEqual([
      {
        code: 'custom',
        message: 'Parameter "from" in "query" is used in both "parameters" and "fixedOperationParameters"',
        path: ['endpoints', 0, 'parameters', 0],
      },
      {
        code: 'custom',
        message: 'Parameter "from" in "query" is used in both "parameters" and "fixedOperationParameters"',
        path: ['endpoints', 0, 'fixedOperationParameters', 1],
      },
    ]);
  });

  it('fails if parameter names are not unique', () => {
    const ois = loadOisFixture();
    const paramName = 'new-param';
    ois.apiSpecifications.paths['/convert'].get!.parameters.push({
      in: 'cookie',
      name: paramName,
    });
    ois.endpoints[0].parameters.push({
      operationParameter: { in: 'cookie', name: paramName },
      name: ois.endpoints[0].parameters[0].name,
    });

    expect(oisSchema.safeParse(ois).error?.issues).toStrictEqual([
      {
        code: 'custom',
        message: 'Parameter names must be unique, but parameter "from" is used multiple times',
        path: ['endpoints', 0, 'parameters', 0],
      },
      {
        code: 'custom',
        message: 'Parameter names must be unique, but parameter "from" is used multiple times',
        path: ['endpoints', 0, 'parameters', 3],
      },
    ]);
  });
});

test('verifies parameter interpolation in "apiSpecification.paths"', () => {
  const ois = loadOisFixture();
  ois.apiSpecifications.paths['/someEndpoint/{id1}/{id2}'] = {
    get: {
      parameters: [
        {
          in: 'path',
          name: 'id1',
        },
      ],
    },
    post: {
      parameters: [
        {
          in: 'path',
          name: 'id2',
        },
        {
          in: 'path',
          name: 'id3',
        },
      ],
    },
  };

  expect(oisSchema.safeParse(ois).error?.issues).toStrictEqual([
    {
      code: 'custom',
      message: 'Path parameter "id2" is not found in "parameters"',
      path: ['apiSpecifications', 'paths', '/someEndpoint/{id1}/{id2}', 'get', 'parameters'],
    },
    {
      code: 'custom',
      message: 'Path parameter "id1" is not found in "parameters"',
      path: ['apiSpecifications', 'paths', '/someEndpoint/{id1}/{id2}', 'post', 'parameters'],
    },
    {
      code: 'custom',
      message: 'Parameter "id3" is not found in the URL path',
      path: ['apiSpecifications', 'paths', '/someEndpoint/{id1}/{id2}', 'post', 'parameters', 1],
    },
  ]);
});

test('fails if apiSpecifications.security.<securitySchemeName> is not defined in apiSpecifications.components.<securitySchemeName>', () => {
  const invalidSecuritySchemeName = 'INVALID_SECURITY_SCHEME_NAME';
  const ois = loadOisFixture();
  const invalidOis = {
    ...ois,

    apiSpecifications: {
      ...ois.apiSpecifications,
      security: { ...ois.apiSpecifications.security, [invalidSecuritySchemeName]: [] },
    },
  };

  expect(oisSchema.safeParse(invalidOis).error?.issues).toStrictEqual([
    {
      code: 'custom',
      message: `Security scheme "${invalidSecuritySchemeName}" is not defined in "components.securitySchemes"`,
      path: ['apiSpecifications', 'security', 1],
    },
  ]);
});

describe('apiSpecification parameters validation', () => {
  it('fails if "apiSpecification.paths" parameter is not defined in "endpoints"', () => {
    const invalidOis = loadOisFixture();
    invalidOis.apiSpecifications.paths['/convert'].get!.parameters.push({
      in: 'query',
      name: 'non-existing-parameter',
    });

    expect(oisSchema.safeParse(invalidOis).error?.issues).toStrictEqual([
      {
        code: 'custom',
        message: 'Parameter "non-existing-parameter" not found in "fixedOperationParameters" or "parameters"',
        path: ['endpoints', 0],
      },
    ]);
  });

  it('"endpoint" parameter must reference parameter from "apiSpecification.paths"', () => {
    const invalidOis = loadOisFixture();
    invalidOis.endpoints[0].parameters.push({
      name: 'some-new-param',
      default: 'EUR',
      operationParameter: {
        in: 'query',
        name: 'non-existing-param',
      },
    });

    expect(oisSchema.safeParse(invalidOis).error?.issues).toStrictEqual([
      {
        code: 'custom',
        message: 'No matching API specification parameter found in "apiSpecifications" section',
        path: ['endpoints', 0, 'parameters', 3],
      },
    ]);
  });

  it('allows endpoint "parameters" without an "operationParameter"', () => {
    const ois = loadOisFixture();
    ois.endpoints[0].parameters.push({
      name: 'noOperationParameter',
      default: 'EUR',
    });

    expect(() => oisSchema.parse(ois)).not.toThrow();
  });

  it('handles multiple endpoints for the same API specification', () => {
    const ois = loadOisFixture();
    ois.endpoints.push(cloneDeep(ois.endpoints[0]));
    ois.apiSpecifications.paths['/convert'].get!.parameters.push({
      in: 'query',
      name: 'api-param-name',
    });

    expect(oisSchema.safeParse(ois).error?.issues).toStrictEqual([
      {
        code: 'custom',
        message: 'Parameter "api-param-name" not found in "fixedOperationParameters" or "parameters"',
        path: ['endpoints', 0],
      },
      {
        code: 'custom',
        message: 'Parameter "api-param-name" not found in "fixedOperationParameters" or "parameters"',
        path: ['endpoints', 1],
      },
    ]);
  });

  it('fails when there is no matching API specification for endpoint', () => {
    const invalidOis = loadOisFixture();
    invalidOis.endpoints[0].parameters.push({
      operationParameter: {
        in: 'query',
        name: 'non-existent',
      },
      name: 'param-name',
    });

    expect(oisSchema.safeParse(invalidOis).error?.issues).toStrictEqual([
      {
        code: 'custom',
        message: 'No matching API specification parameter found in "apiSpecifications" section',
        path: ['endpoints', 0, 'parameters', 3],
      },
    ]);
  });

  it('fails when there are multiple API specification parameters', () => {
    const invalidOis = loadOisFixture();
    invalidOis.apiSpecifications.paths['/convert'].get!.parameters.push(
      invalidOis.apiSpecifications.paths['/convert'].get!.parameters[0]
    );

    expect(oisSchema.safeParse(invalidOis).error?.issues).toStrictEqual([
      {
        code: 'custom',
        message: 'Parameter "from" in "query" is used multiple times',
        path: ['apiSpecifications', 'paths', '/convert', 'get', 'parameters', 0],
      },
      {
        code: 'custom',
        message: 'Parameter "from" in "query" is used multiple times',
        path: ['apiSpecifications', 'paths', '/convert', 'get', 'parameters', 4],
      },
    ]);
  });
});

test('validates path name', () => {
  expect(pathNameSchema.safeParse('my-path').error?.issues).toStrictEqual([
    {
      code: 'invalid_format',
      format: 'regex',
      message: 'Invalid string: must match pattern /^\\/\\S*$/',
      origin: 'string',
      path: [],
      pattern: '/^\\/\\S*$/',
    },
  ]);

  expect(pathNameSchema.safeParse('/my path').error?.issues).toStrictEqual([
    {
      code: 'invalid_format',
      format: 'regex',
      message: 'Invalid string: must match pattern /^\\/\\S*$/',
      origin: 'string',
      path: [],
      pattern: '/^\\/\\S*$/',
    },
  ]);

  expect(() => pathNameSchema.parse('/my-path')).not.toThrow();

  expect(() => pathNameSchema.parse('/')).not.toThrow();
});

test('validates semantic versioning', () => {
  expect(semverSchema.safeParse('1.0').error?.issues).toStrictEqual([
    {
      code: 'custom',
      message: 'Expected semantic versioning "x.y.z"',
      path: [],
    },
  ]);
  expect(semverSchema.safeParse('0.x.y').error?.issues).toStrictEqual([
    {
      code: 'custom',
      message: 'Expected semantic versioning "x.y.z"',
      path: [],
    },
  ]);
  expect(semverSchema.safeParse('^0.1.1').error?.issues).toStrictEqual([
    {
      code: 'custom',
      message: 'Expected semantic versioning "x.y.z"',
      path: [],
    },
  ]);
  expect(semverSchema.safeParse('0.1.1.2').error?.issues).toStrictEqual([
    {
      code: 'custom',
      message: 'Expected semantic versioning "x.y.z"',
      path: [],
    },
  ]);

  expect(() => semverSchema.parse('1.0.0')).not.toThrow();
  expect(() => semverSchema.parse('00.01.02')).not.toThrow();
});

describe('oisFormat version', () => {
  const [packageMajor, packageMinor, packagePatch] = packageVersion.split('.');

  const differentPatch = `${packageMajor}.${packageMinor}.${Number.parseInt(packagePatch, 10) + 1}`;
  const differentMinor = `${packageMajor}.${Number.parseInt(packageMinor, 10) + 1}.${packagePatch}`;
  const differentMajor = `${Number.parseInt(packageMajor, 10) + 1}.${packageMinor}.${packagePatch}`;

  it('validates packageVersion conforms to semver', () => {
    expect(() => semverSchema.parse(packageVersion)).not.toThrow();
  });

  it('allows same version as packageVersion', () => {
    expect(() => packageVersionCompatibleSemverSchema.parse(packageVersion)).not.toThrow();
  });

  it('allows different packageVersion patch', () => {
    expect(() => packageVersionCompatibleSemverSchema.parse(differentPatch)).not.toThrow();
  });

  it('disallows different packageVersion minor', () => {
    expect(packageVersionCompatibleSemverSchema.safeParse(differentMinor).error?.issues).toStrictEqual([
      {
        code: 'custom',
        message: `oisFormat major.minor version must match major.minor version of "${packageVersion}"`,
        path: [],
      },
    ]);
  });

  it('disallows different packageVersion major', () => {
    expect(packageVersionCompatibleSemverSchema.safeParse(differentMajor).error?.issues).toStrictEqual([
      {
        code: 'custom',
        message: `oisFormat major.minor version must match major.minor version of "${packageVersion}"`,
        path: [],
      },
    ]);
  });

  it('validates oisFormat field within oisSchema', () => {
    const invalidOis = loadOisFixture();
    invalidOis.oisFormat = '0.0.0';

    expect(oisSchema.safeParse(invalidOis).error?.issues).toStrictEqual([
      {
        code: 'custom',
        message: `oisFormat major.minor version must match major.minor version of "${packageVersion}"`,
        path: ['oisFormat'],
      },
    ]);
  });
});

describe('reservedParameter validation', () => {
  it('validates reserved parameters', () => {
    expect(
      reservedParameterSchema.safeParse({
        name: '_times',
        default: '123',
        fixed: '123',
      }).error?.issues
    ).toStrictEqual([
      {
        code: 'custom',
        message: 'Reserved parameter must use at most one of "default" and "fixed" properties',
        path: [],
      },
    ]);

    // Empty parameter is allowed (the user is expected to pass it or it won't be used)
    expect(() =>
      reservedParameterSchema.parse({
        name: '_times',
      })
    ).not.toThrow();
  });

  it('disallows reserved parameters without { "name": "_type" }', () => {
    expect(
      reservedParametersSchema.safeParse([{ name: '_path', default: 'data.0.price' }]).error?.issues
    ).toStrictEqual([
      {
        code: 'custom',
        message: 'Reserved parameters must contain object with { "name": "_type" }',
        path: [],
      },
    ]);
  });

  it('allows reserved parameters with only { "name": "_type" }', () => {
    expect(() => reservedParametersSchema.parse([{ name: '_type', fixed: 'int256' }])).not.toThrow();
  });

  // eslint-disable-next-line jest/require-hook
  ['_minConfirmations', '_gasPrice'].forEach((reservedParam) => {
    it(`allows missing value or non-negative integer strings for ${reservedParam}`, () => {
      const validIntStrDefault = { name: reservedParam, default: '3' };
      const validIntStrFixed = { name: reservedParam, fixed: '3' };
      // If default and fixed are absent, the user (requester) is expected to pass the value as parameter
      const validMissing = { name: reservedParam };
      const invalidNotInt = { name: reservedParam, default: 'text' };
      const invalidNegativeInt = { name: reservedParam, default: '-5' };

      [validIntStrDefault, validIntStrFixed, validMissing].forEach((obj) =>
        expect(() => reservedParameterSchema.parse(obj)).not.toThrow()
      );

      [invalidNotInt, invalidNegativeInt].forEach((obj) =>
        expect(reservedParameterSchema.safeParse(obj).error?.issues).toStrictEqual([
          {
            code: 'custom',
            message: `Reserved parameter ${reservedParam} must be a non-negative integer if present`,
            path: [],
          },
        ])
      );
    });
  });
});

describe('skip API call validation', () => {
  it(`fails if both "endpoint[n].preProcessingSpecifications" and "endpoint[n].postProcessingSpecifications" are undefined when "endpoint[n].operation" is undefined and "endpoint[n].fixedOperationParameters" is empty array.`, () => {
    const invalidOis = loadOisFixture();
    invalidOis.endpoints[0].operation = undefined;
    invalidOis.endpoints[0].fixedOperationParameters = [];
    invalidOis.endpoints[0].preProcessingSpecifications = undefined;
    invalidOis.endpoints[0].postProcessingSpecifications = undefined;
    expect(oisSchema.safeParse(invalidOis).error?.issues).toStrictEqual([
      {
        code: 'custom',
        message: `At least one processing schema must be defined when "operation" is not specified and "fixedOperationParameters" is empty array.`,
        path: ['endpoints', 0],
      },
    ]);
  });

  it(`fails if both "endpoint[n].preProcessingSpecifications" and "endpoint[n].postProcessingSpecifications" are empty array when "endpoint[n].operation" is undefined and "endpoint[n].fixedOperationParameters" is empty array.`, () => {
    const invalidOis = loadOisFixture();
    invalidOis.endpoints[0].operation = undefined;
    invalidOis.endpoints[0].fixedOperationParameters = [];
    invalidOis.endpoints[0].preProcessingSpecifications = [];
    invalidOis.endpoints[0].postProcessingSpecifications = [];
    expect(oisSchema.safeParse(invalidOis).error?.issues).toStrictEqual([
      {
        code: 'custom',
        message: `At least one processing schema must be defined when "operation" is not specified and "fixedOperationParameters" is empty array.`,
        path: ['endpoints', 0],
      },
    ]);
  });

  it(`allow "endpoint[n].operation" to be undefined and "endpoint[n].fixedOperationParameters" to be empty array when "endpoint[n].preProcessingSpecifications" is defined for skipping API call.`, () => {
    const ois = loadOisFixture();
    ois.endpoints[0].operation = undefined;
    ois.endpoints[0].fixedOperationParameters = [];
    ois.endpoints[0].preProcessingSpecifications = [
      {
        environment: 'Node',
        timeoutMs: 5000,
        value: 'output = input;',
      },
    ];
    ois.endpoints[0].postProcessingSpecifications = undefined;
    expect(() => oisSchema.parse(ois)).not.toThrow();
  });

  it(`allow "endpoint[n].operation" to be undefined and "endpoint[n].fixedOperationParameters" to be empty array when "endpoint[n].postProcessingSpecifications" is defined for skipping API call.`, () => {
    const ois = loadOisFixture();
    ois.endpoints[0].operation = undefined;
    ois.endpoints[0].fixedOperationParameters = [];
    ois.endpoints[0].preProcessingSpecifications = undefined;
    ois.endpoints[0].postProcessingSpecifications = [
      {
        environment: 'Node',
        timeoutMs: 5000,
        value: 'output = input;',
      },
    ];
    expect(() => oisSchema.parse(ois)).not.toThrow();
  });

  it(`allow "endpoint[n].operation" to be undefined and "endpoint[n].fixedOperationParameters" to be empty array when both "endpoint[n].preProcessingSpecifications" and "endpoint[n].postProcessingSpecifications" are defined for skipping API call.`, () => {
    const ois = loadOisFixture();
    ois.endpoints[0].operation = undefined;
    ois.endpoints[0].fixedOperationParameters = [];
    ois.endpoints[0].preProcessingSpecifications = [
      {
        environment: 'Node',
        timeoutMs: 5000,
        value: 'output = input;',
      },
    ];
    ois.endpoints[0].postProcessingSpecifications = [
      {
        environment: 'Node',
        timeoutMs: 5000,
        value: 'output = input;',
      },
    ];
    expect(() => oisSchema.parse(ois)).not.toThrow();
  });

  it(`fails if "endpoint[n].fixedOperationParameters" is not empty array when "endpoint[n].operation" is undefined.`, () => {
    const invalidOis = loadOisFixture();
    invalidOis.endpoints[0].operation = undefined;
    invalidOis.endpoints[0].fixedOperationParameters = [
      {
        operationParameter: {
          in: 'query',
          name: 'to',
        },
        value: 'USD',
      },
    ];
    expect(oisSchema.safeParse(invalidOis).error?.issues).toStrictEqual([
      {
        code: 'custom',
        message: `"fixedOperationParameters" must be empty array when "operation" is not specified.`,
        path: ['endpoints', 0],
      },
    ]);
  });

  it('allows skipping API call with pre-processing v2', () => {
    const ois = loadOisFixture();
    ois.endpoints[0].operation = undefined;
    ois.endpoints[0].fixedOperationParameters = [];
    ois.endpoints[0].preProcessingSpecificationV2 = {
      environment: 'Node',
      timeoutMs: 5000,
      value: "({ endpointParameters }) => { return { endpointParameters: {...endpointParameters, from: 'ETH'} }; }",
    };

    expect(() => oisSchema.parse(ois)).not.toThrow();
  });

  it('allows skipping API call with post-processing v2', () => {
    const ois = loadOisFixture();
    ois.endpoints[0].operation = undefined;
    ois.endpoints[0].fixedOperationParameters = [];
    ois.endpoints[0].postProcessingSpecificationV2 = {
      environment: 'Node',
      timeoutMs: 5000,
      value: '({ response }) => { return { response: Math.round(Math.random() * 1000) } }',
    };

    expect(() => oisSchema.parse(ois)).not.toThrow();
  });
});

describe('fixedOperationParameters', () => {
  it('allows objects as values', () => {
    const valueWithObject = {
      operationParameter: { in: 'query', name: 'params' },
      value: ['finalized', false],
    };

    expect(() => fixedParameterSchema.parse(valueWithObject)).not.toThrow();
  });
});

describe('processing specification', () => {
  it('allows pre-processing and post-processing specifications with different version', () => {
    const endpoint1 = { ...loadOisFixture().endpoints[0] };
    endpoint1.preProcessingSpecifications = [
      {
        environment: 'Node',
        timeoutMs: 5000,
        value: 'output = input;',
      },
    ];
    endpoint1.postProcessingSpecificationV2 = {
      environment: 'Node',
      timeoutMs: 5000,
      value: '(payload) => payload;',
    };
    const endpoint2 = { ...loadOisFixture().endpoints[0] };
    endpoint2.preProcessingSpecificationV2 = {
      environment: 'Node',
      timeoutMs: 5000,
      value: '(payload) => payload;',
    };
    endpoint2.postProcessingSpecifications = [
      {
        environment: 'Node',
        timeoutMs: 5000,
        value: 'output = input;',
      },
    ];

    expect(() => endpointSchema.parse(endpoint1)).not.toThrow();
    expect(() => endpointSchema.parse(endpoint2)).not.toThrow();
  });

  it('throws when conflicting processing specifications are defined', () => {
    const endpoint1 = { ...loadOisFixture().endpoints[0] };
    endpoint1.preProcessingSpecifications = [
      {
        environment: 'Node',
        timeoutMs: 5000,
        value: 'output = input;',
      },
    ];
    endpoint1.preProcessingSpecificationV2 = {
      environment: 'Node',
      timeoutMs: 5000,
      value: '(payload) => payload;',
    };
    const endpoint2 = { ...loadOisFixture().endpoints[0] };
    endpoint2.postProcessingSpecifications = [
      {
        environment: 'Node',
        timeoutMs: 5000,
        value: 'output = input;',
      },
    ];
    endpoint2.postProcessingSpecificationV2 = {
      environment: 'Node',
      timeoutMs: 5000,
      value: '(payload) => payload;',
    };

    expect(endpointSchema.safeParse(endpoint1).error?.issues).toStrictEqual([
      {
        code: 'custom',
        message: 'Only one of "preProcessingSpecificationV2" and "preProcessingSpecifications" can be defined',
        path: [],
      },
    ]);

    expect(endpointSchema.safeParse(endpoint2).error?.issues).toStrictEqual([
      {
        code: 'custom',
        message: 'Only one of "postProcessingSpecificationV2" and "postProcessingSpecifications" can be defined',
        path: [],
      },
    ]);
  });
});
