import { find, forEach, groupBy, trimEnd, trimStart } from 'lodash';
import { type SuperRefinement, z } from 'zod';

import { version as packageVersion } from '../package.json';

import { type SchemaType } from './types';

function removeBraces(value: string) {
  return trimEnd(trimStart(value, '{'), '}');
}

const nonNegativeIntSchema = z.number().int().nonnegative();

export const parameterTargetSchema = z.union([
  z.literal('path'),
  z.literal('query'),
  z.literal('header'),
  z.literal('cookie'),
  z.literal('processing'),
]);

const nonReservedParameterNameSchema = z.string().refine(
  (val) => reservedParameterNameSchema.safeParse(val).success === false,
  (val) => ({ message: `"${val}" cannot be used because it is a name of a reserved parameter` })
);
export const operationParameterSchema = z
  .object({
    in: parameterTargetSchema,
    name: nonReservedParameterNameSchema,
  })
  .strict();

export const fixedParameterSchema = z
  .object({
    operationParameter: operationParameterSchema,
    value: z.any(),
  })
  .strict();

export const methodSchema = z.union([z.literal('get'), z.literal('post')]);

// Path name must start wih "/" and must not contain space character
export const pathNameSchema = z.string().regex(/^\/\S*$/);

export const endpointOperationSchema = z
  .object({
    method: methodSchema,
    path: pathNameSchema,
  })
  .strict();

export const endpointParameterSchema = z
  .object({
    // Parameter name must not contain spaces
    name: z.string().regex(/^\S+$/),
    operationParameter: operationParameterSchema.optional(),

    // The following optional fields are defined by OAS. They are intended to provide more
    // clarity about a parameter and are ignored by Airnode
    description: z.string().optional(),
    example: z.string().optional(),

    // Default value is used when the user (requester) does not provide a value for the parameter
    default: z.string().optional(),
    // This property is completely ignored by Airnode
    required: z.boolean().optional(),
  })
  .strict();

export const reservedParameterNameSchema = z.union([
  z.literal('_type'),
  z.literal('_path'),
  z.literal('_times'),
  z.literal('_minConfirmations'),
  z.literal('_gasPrice'),
]);

export const reservedParameterSchema = z
  .object({
    name: reservedParameterNameSchema,
    // At most one of the following fields can be used. If none of them is used,
    // the user (requester) is expected to pass the value as parameter
    default: z.string().optional(),
    fixed: z.string().optional(),
  })
  .strict()
  .refine((value) => {
    const { fixed, default: defaultValue } = value;

    // Explicitly check for "undefined", since empty string is a valid reserved parameter value
    const isFixedValueDefined = fixed !== undefined;
    const isDefaultValueDefined = defaultValue !== undefined;

    return !isFixedValueDefined || !isDefaultValueDefined;
  }, 'Reserved parameter must use at most one of "default" and "fixed" properties')
  .superRefine((param, ctx) => {
    // Default or fixed, or neither, may be present as validated by refine above
    const val = param.default ?? param.fixed;
    const { name } = param;

    // Validate value if present
    if (
      (name === '_minConfirmations' || name === '_gasPrice') &&
      val &&
      !nonNegativeIntSchema.safeParse(Number.parseInt(val, 10)).success
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Reserved parameter ${name} must be a non-negative integer if present`,
      });
    }
  });

export const serverSchema = z
  .object({
    url: z.string().url(),
  })
  .strict();

export const httpSecuritySchemeSchema = z
  .object({
    scheme: z.union([z.literal('bearer'), z.literal('basic')]),
    type: z.literal('http'),
  })
  .strict();

export const securitySchemeTargetSchema = z.union([z.literal('query'), z.literal('header'), z.literal('cookie')]);

export const configurableSecuritySchemeSchema = z
  .object({
    in: securitySchemeTargetSchema,
    name: z.string(),
  })
  .strict();

export const apiKeySecuritySchemeSchema = configurableSecuritySchemeSchema
  .extend({ type: z.literal('apiKey') })
  .strict();

export const RELAY_METADATA_TYPES = [
  'relayChainId',
  'relayChainType',
  'relayRequesterAddress',
  'relaySponsorAddress',
  'relaySponsorWalletAddress',
  'relayRequestId',
] as const;

export const apiSecuritySchemeSchema = z.discriminatedUnion('type', [
  apiKeySecuritySchemeSchema,
  httpSecuritySchemeSchema,
  ...RELAY_METADATA_TYPES.map((relayMetadataType) =>
    configurableSecuritySchemeSchema
      .extend({
        type: z.literal(relayMetadataType),
      })
      .strict()
  ),
]);

// OAS supports also "oauth2" and "openIdConnect", but we don't

export const apiComponentsSchema = z
  .object({
    securitySchemes: z.record(z.string(), apiSecuritySchemeSchema),
  })
  .strict();

export const operationSchema = z
  .object({
    parameters: z.array(operationParameterSchema),
  })
  .strict();

export const httpStatusCodes = z.union([z.literal('get'), z.literal('post')]);

export const pathSchema = z.record(httpStatusCodes, operationSchema);

const ensurePathParametersExist: SuperRefinement<Record<string, SchemaType<typeof pathSchema>>> = (paths, ctx) => {
  forEach(paths, (pathData, rawPath) => {
    forEach(pathData, (paramData, httpMethod) => {
      const { parameters } = paramData!;
      // Match on anything in the path that is braces
      // i.e. The path /users/{id}/{action} will match ['{id}', '{action}']
      const regex = /{[^}]+}/g;
      const matches = rawPath.match(regex)?.map(removeBraces) ?? [];

      // Check that all path parameters are defined
      matches.forEach((match) => {
        const parameter = parameters.find((p) => p.in === 'path' && p.name === match);
        if (!parameter) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Path parameter "${match}" is not found in "parameters"`,
            path: [rawPath, httpMethod, 'parameters'],
          });
        }
      });

      // Check that all parameters are used
      parameters.forEach((p, index) => {
        if (p.in === 'path' && !matches.includes(p.name)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Parameter "${p.name}" is not found in the URL path`,
            path: [rawPath, httpMethod, 'parameters', index],
          });
        }
      });
    });
  });
};

const ensureUniqueApiSpecificationParameters: SuperRefinement<Record<string, SchemaType<typeof pathSchema>>> = (
  paths,
  ctx
) => {
  forEach(paths, (pathData, rawPath) => {
    forEach(pathData, (paramData, httpMethod) => {
      const { parameters } = paramData!;

      const getGroupId = (param: OperationParameter) => param.in + param.name;
      const groups = Object.values(groupBy(parameters, getGroupId));
      const duplicates = new Set(groups.filter((group) => group.length > 1).flat());

      parameters.forEach((parameter, index) => {
        if (!duplicates.has(parameter)) return;

        const { in: location, name } = parameter;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Parameter "${name}" in "${location}" is used multiple times`,
          path: [rawPath, httpMethod, 'parameters', index],
        });
      });
    });
  });
};

export const pathsSchema = z
  .record(pathNameSchema, pathSchema)
  .superRefine(ensurePathParametersExist)
  .superRefine(ensureUniqueApiSpecificationParameters);

export const apiSpecificationSchema = z
  .object({
    components: apiComponentsSchema,
    paths: pathsSchema,
    servers: z.array(serverSchema),
    security: z.record(z.string(), z.tuple([])),
  })
  .strict()
  .superRefine((apiSpecifications, ctx) => {
    Object.keys(apiSpecifications.security).forEach((enabledSecuritySchemeName, index) => {
      // Verify that ois.apiSpecifications.security.<securitySchemeName> is
      // referencing a valid ois.apiSpecifications.components.<securitySchemeName> object
      const enabledSecurityScheme = apiSpecifications.components.securitySchemes[enabledSecuritySchemeName];
      if (!enabledSecurityScheme) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Security scheme "${enabledSecuritySchemeName}" is not defined in "components.securitySchemes"`,
          path: ['security', index],
        });
      }
    });
  });

export const processingSpecificationSchema = z
  .object({
    environment: z.union([z.literal('Node'), z.literal('Node async')]),
    value: z.string(),
    timeoutMs: nonNegativeIntSchema,
  })
  .strict();

export const processingSpecificationSchemaV2 = z
  .object({
    environment: z.literal('Node'),
    value: z.string(),
    timeoutMs: nonNegativeIntSchema,
  })
  .strict();

const ensureUniqueEndpointParameterNames: SuperRefinement<EndpointParameter[]> = (parameters, ctx) => {
  const groups = Object.values(groupBy(parameters, 'name'));
  const duplicates = new Set(groups.filter((group) => group.length > 1).flatMap((group) => group.map((p) => p.name)));

  parameters.forEach((parameter, index) => {
    const { name } = parameter;
    if (duplicates.has(name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Parameter names must be unique, but parameter "${name}" is used multiple times`,
        path: [index],
      });
    }
  });
};

const endpointParametersSchema = z.array(endpointParameterSchema).superRefine(ensureUniqueEndpointParameterNames);

export const reservedParametersSchema = z.array(reservedParameterSchema).superRefine((params, ctx) => {
  const anyContainType = params.some((param) => {
    return param.name === '_type';
  });

  if (!anyContainType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Reserved parameters must contain object with { "name": "_type" }',
    });
  }
});

export const endpointSchema = z
  .object({
    fixedOperationParameters: z.array(fixedParameterSchema),
    name: z.string(),
    operation: endpointOperationSchema.optional(),
    parameters: endpointParametersSchema,
    reservedParameters: reservedParametersSchema,

    // Processing is and advanced use case that needs to be used with special care. For this reason,
    // we are defining the processing specification as optional fields.
    preProcessingSpecifications: z.array(processingSpecificationSchema).optional(),
    postProcessingSpecifications: z.array(processingSpecificationSchema).optional(), // eslint-disable-line sort-keys

    // Post-processing only supported processing value, but there are use cases for processing timestamp as well. With
    // the original processing specification, users needed to assign processed value to a special output variable and
    // the schema supported multiple snippets that are composed together which is not necessary. For further information
    // see: https://github.com/api3dao/commons/issues/27.
    //
    // A new processing implementation is created that addresses all the previously mentioned issues. The schemas remain
    // optional, for the same reasons as in the original implementation.
    preProcessingSpecificationV2: processingSpecificationSchemaV2.optional(),
    postProcessingSpecificationV2: processingSpecificationSchemaV2.optional(), // eslint-disable-line sort-keys

    // The following fields are ignored by Airnode
    description: z.string().optional(),
    externalDocs: z.string().optional(),
    summary: z.string().optional(),
  })
  .strict()
  .superRefine((endpoint, ctx) => {
    const {
      preProcessingSpecificationV2,
      preProcessingSpecifications,
      postProcessingSpecificationV2,
      postProcessingSpecifications,
    } = endpoint;

    if (preProcessingSpecificationV2 && preProcessingSpecifications) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only one of "preProcessingSpecificationV2" and "preProcessingSpecifications" can be defined',
      });
    }

    if (postProcessingSpecificationV2 && postProcessingSpecifications) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only one of "postProcessingSpecificationV2" and "postProcessingSpecifications" can be defined',
      });
    }
  });

const ensureSingleParameterUsagePerEndpoint: SuperRefinement<{
  endpoints: Endpoint[];
}> = (ois, ctx) => {
  ois.endpoints.forEach((endpoint, oisIndex) => {
    const params = endpoint.parameters.map((p) => p.operationParameter);
    const fixedParams = endpoint.fixedOperationParameters.map((p) => p.operationParameter);

    const checkUniqueness = (section: 'parameters' | 'fixedOperationParameters') => {
      const paramsToCheck = section === 'parameters' ? params : fixedParams;
      paramsToCheck.forEach((param, paramIndex) => {
        if (!param) return;
        const count = paramsToCheck.filter((p) => p && p.in === param.in && p.name === param.name).length;
        if (count > 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Parameter "${param.name}" in "${param.in}" is used multiple times`,
            path: ['endpoints', oisIndex, section, paramIndex],
          });
        }
      });
    };

    checkUniqueness('parameters');
    checkUniqueness('fixedOperationParameters');

    // Check uniqueness across "parameters" and "fixedOperationParameters"
    params.forEach((param, paramIndex) => {
      if (!param) return;
      const fixedParam = fixedParams.find((p) => p.in === param.in && p.name === param.name);
      if (fixedParam) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Parameter "${param.name}" in "${param.in}" is used in both "parameters" and "fixedOperationParameters"`,
          path: ['endpoints', oisIndex, 'parameters', paramIndex],
        });

        // Add also an issue for the fixed parameter. This makes it easier for the user to find the offending parameter
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Parameter "${param.name}" in "${param.in}" is used in both "parameters" and "fixedOperationParameters"`,
          path: ['endpoints', oisIndex, 'fixedOperationParameters', fixedParams.indexOf(fixedParam)],
        });
      }
    });
  });
};

const ensureApiCallSkipRequirements: SuperRefinement<{
  endpoints: Endpoint[];
}> = (ois, ctx) => {
  const { endpoints } = ois;
  forEach(endpoints, (endpoint) => {
    if (
      !endpoint.operation &&
      endpoint.fixedOperationParameters.length === 0 &&
      (!endpoint.postProcessingSpecifications || endpoint.postProcessingSpecifications?.length === 0) &&
      (!endpoint.preProcessingSpecifications || endpoint.preProcessingSpecifications?.length === 0) &&
      !endpoint.preProcessingSpecificationV2 &&
      !endpoint.postProcessingSpecificationV2
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `At least one processing schema must be defined when "operation" is not specified and "fixedOperationParameters" is empty array.`,
        path: ['endpoints', endpoints.indexOf(endpoint)],
      });
    }

    if (!endpoint.operation && endpoint.fixedOperationParameters.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"fixedOperationParameters" must be empty array when "operation" is not specified.`,
        path: ['endpoints', endpoints.indexOf(endpoint)],
      });
    }
  });
};

const ensureEndpointAndApiSpecificationParamsMatch: SuperRefinement<{
  endpoints: Endpoint[];
  apiSpecifications: ApiSpecification;
}> = (ois, ctx) => {
  const { apiSpecifications, endpoints } = ois;

  // Ensure every "apiSpecification.paths" parameter is defined in "endpoints"
  forEach(apiSpecifications.paths, (pathData, rawPath) => {
    forEach(pathData, (paramData, httpMethod) => {
      const apiEndpoints = endpoints.filter(({ operation }) => {
        if (!operation) return false;
        return operation.method === httpMethod && operation.path === rawPath;
      });
      if (apiEndpoints.length === 0) return; // Missing endpoint for apiSpecification should only be a warning

      apiEndpoints.forEach((endpoint) => {
        paramData!.parameters.forEach((apiParam) => {
          const allEndpointParams = [...endpoint.parameters, ...endpoint.fixedOperationParameters];
          const endpointParam = allEndpointParams.find(
            ({ operationParameter }) =>
              operationParameter && operationParameter.in === apiParam.in && operationParameter.name === apiParam.name
          );
          if (!endpointParam) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Parameter "${apiParam.name}" not found in "fixedOperationParameters" or "parameters"`,
              path: ['endpoints', endpoints.indexOf(endpoint)],
            });
          }
        });
      });
    });
  });

  // Ensure every endpoint parameter references parameter from "apiSpecification.paths"
  endpoints.forEach((endpoint, endpointIndex) => {
    if (!endpoint.operation) return;
    const { operation, parameters, fixedOperationParameters } = endpoint;

    const apiSpec = find(apiSpecifications.paths, (pathData, path) => {
      if (operation.path !== path) return false;

      return !!find(pathData, (_, httpMethod) => operation.method === httpMethod);
    });
    if (!apiSpec) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `No matching API specification found in "apiSpecifications" section`,
        path: ['endpoints', endpointIndex],
      });
      return;
    }

    // Ensure every parameter exist in "apiSpecification"
    parameters.forEach((endpointParam, endpointParamIndex) => {
      const { operationParameter } = endpointParam;
      if (!operationParameter) return;
      const apiParam = apiSpec[operation.method]!.parameters.find(
        (p) => p.in === operationParameter.in && p.name === operationParameter.name
      );

      if (!apiParam) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `No matching API specification parameter found in "apiSpecifications" section`,
          path: ['endpoints', endpointIndex, 'parameters', endpointParamIndex],
        });
      }
    });

    // Ensure every fixed parameter exist in "apiSpecification"
    fixedOperationParameters.forEach((endpointParam, endpointParamIndex) => {
      const { operationParameter } = endpointParam;
      const apiParam = apiSpec[operation.method]!.parameters.find(
        (p) => p.in === operationParameter.in && p.name === operationParameter.name
      );

      if (!apiParam) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `No matching API specification parameter found in "apiSpecifications" section`,
          path: ['endpoints', endpointIndex, 'fixedOperationParameters', endpointParamIndex],
        });
      }
    });
  });
};

export const semverSchema = z.string().refine((value) => {
  const semver = value.split('.');
  if (semver.length !== 3) return false;

  return !semver.some((part) => /^\d+$/.test(part) === false);
}, 'Expected semantic versioning "x.y.z"');

export const packageVersionCompatibleSemverSchema = semverSchema.refine((semver) => {
  const [oisMajor, oisMinor] = semver.split('.');
  const [packageMajor, packageMinor] = packageVersion.split('.');
  return oisMajor === packageMajor && oisMinor === packageMinor;
}, `oisFormat major.minor version must match major.minor version of "${packageVersion}"`);

export const oisSchema = z
  .object({
    oisFormat: packageVersionCompatibleSemverSchema,
    // Limit the title to 64 characters
    title: z.string().regex(/^[\s\w-]{1,64}$/),
    version: semverSchema,
    apiSpecifications: apiSpecificationSchema,
    endpoints: z.array(endpointSchema),
  })
  .strict()
  .superRefine(ensureSingleParameterUsagePerEndpoint)
  .superRefine(ensureEndpointAndApiSpecificationParamsMatch)
  .superRefine(ensureApiCallSkipRequirements);

export const RESERVED_PARAMETERS = reservedParameterNameSchema.options.map((option) => option.value);
export type Paths = SchemaType<typeof pathsSchema>;
export type ParameterTarget = SchemaType<typeof parameterTargetSchema>;
export type OperationParameter = SchemaType<typeof operationParameterSchema>;
export type FixedParameter = SchemaType<typeof fixedParameterSchema>;
export type EndpointParameter = SchemaType<typeof endpointParameterSchema>;
export type HttpSecurityScheme = SchemaType<typeof httpSecuritySchemeSchema>;
export type ConfigurableSecurityScheme = SchemaType<typeof configurableSecuritySchemeSchema>;
export type ApiSpecification = SchemaType<typeof apiSpecificationSchema>;
export type ApiSecurityScheme = SchemaType<typeof apiSecuritySchemeSchema>;
export type ApiKeySecurityScheme = SchemaType<typeof apiKeySecuritySchemeSchema>;
export type ProcessingSpecification = SchemaType<typeof processingSpecificationSchema>;
export type ReservedParameterName = SchemaType<typeof reservedParameterNameSchema>;
export type ReservedParameters = SchemaType<typeof reservedParametersSchema>;
export type Operation = SchemaType<typeof operationSchema>;
export type Method = SchemaType<typeof methodSchema>;
export type Endpoint = SchemaType<typeof endpointSchema>;
export type OIS = SchemaType<typeof oisSchema>;
