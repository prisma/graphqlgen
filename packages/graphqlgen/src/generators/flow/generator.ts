import * as os from 'os'
import * as prettier from 'prettier'

import { GenerateArgs, ModelMap, ContextDefinition } from '../../types'
import {
  GraphQLTypeField,
  GraphQLTypeObject,
  GraphQLTypeArgument,
  GraphQLUnionObject,
} from '../../source-helper'
import { upperFirst } from '../../utils'
import {
  getContextName,
  getDistinctInputTypes,
  getModelName,
  groupModelsNameByImportPath,
  InputTypesMap,
  printFieldLikeType,
  renderDefaultResolvers,
  renderEnums,
  TypeToInputTypeAssociation,
  InterfacesMap,
  UnionsMap,
  createInterfacesMap,
  createUnionsMap,
  resolverReturnType,
} from '../common'
import { renderTypeResolveTypeResolver } from '../typescript/generator'

export function format(code: string, options: prettier.Options = {}) {
  try {
    return prettier.format(code, {
      ...options,
      parser: 'flow',
    })
  } catch (e) {
    console.log(
      `There is a syntax error in generated code, unformatted code printed, error: ${JSON.stringify(
        e,
      )}`,
    )
    return code
  }
}

export function generate(args: GenerateArgs): string {
  // TODO: Maybe move this to source helper
  const inputTypesMap: InputTypesMap = args.types
    .filter(type => type.type.isInput)
    .reduce((inputTypes, type) => {
      return {
        ...inputTypes,
        [`${type.name}`]: type,
      }
    }, {})

  // TODO: Type this
  const typeToInputTypeAssociation: TypeToInputTypeAssociation = args.types
    .filter(
      type =>
        type.type.isObject &&
        type.fields.filter(
          field => field.arguments.filter(arg => arg.type.isInput).length > 0,
        ).length > 0,
    )
    .reduce((types, type) => {
      return {
        ...types,
        [`${type.name}`]: [].concat(
          ...(type.fields.map(field =>
            field.arguments
              .filter(arg => arg.type.isInput)
              .map(arg => arg.type.name),
          ) as any),
        ),
      }
    }, {})

  const interfacesMap = createInterfacesMap(args.interfaces)
  const unionsMap = createUnionsMap(args.unions)

  return `\
  ${renderHeader(args)}

  ${renderEnums(args)}

  ${renderNamespaces(
    args,
    interfacesMap,
    unionsMap,
    typeToInputTypeAssociation,
    inputTypesMap,
  )}

  ${renderResolvers(args)}

  `
}

function renderHeader(args: GenerateArgs): string {
  const modelsToImport = Object.keys(args.modelMap).map(k => args.modelMap[k])
  const modelsByImportPaths = groupModelsNameByImportPath(modelsToImport)

  const modelImports = Object.keys(modelsByImportPaths)
    .map(
      importPath =>
        `import type { ${modelsByImportPaths[importPath].join(
          ',',
        )} } from '${importPath}'`,
    )
    .join(os.EOL)

  const graphQLImports = ['GraphQLResolveInfo']

  return `/* @flow */
// Code generated by github.com/prisma/graphqlgen, DO NOT EDIT.

import type { ${graphQLImports.join(', ')} } from 'graphql'
${modelImports}
${renderContext(args.context)}
  `
}

function renderContext(context?: ContextDefinition) {
  if (context) {
    return `import type  { ${getContextName(context)} } from '${
      context.contextPath
    }'`
  }

  return `type ${getContextName(context)} = any`
}

function renderNamespaces(
  args: GenerateArgs,
  interfacesMap: InterfacesMap,
  unionsMap: UnionsMap,
  typeToInputTypeAssociation: TypeToInputTypeAssociation,
  inputTypesMap: InputTypesMap,
): string {
  const objectNamespaces = args.types
    .filter(type => type.type.isObject)
    .map(type =>
      renderNamespace(
        type,
        interfacesMap,
        unionsMap,
        typeToInputTypeAssociation,
        inputTypesMap,
        args,
      ),
    )
    .join(os.EOL)

  return `\
    ${objectNamespaces}

    ${renderUnionNamespaces(args)}
  `
}

function renderNamespace(
  type: GraphQLTypeObject,
  interfacesMap: InterfacesMap,
  unionsMap: UnionsMap,
  typeToInputTypeAssociation: TypeToInputTypeAssociation,
  inputTypesMap: InputTypesMap,
  args: GenerateArgs,
): string {
  const typeName = upperFirst(type.name)

  return `\
    // Types for ${typeName}
    ${
      args.defaultResolversEnabled
        ? renderDefaultResolvers(type, args, `${typeName}_defaultResolvers`)
        : ''
    }

    ${renderInputTypeInterfaces(
      type,
      args.modelMap,
      interfacesMap,
      unionsMap,
      typeToInputTypeAssociation,
      inputTypesMap,
    )}

    ${renderInputArgInterfaces(type, args.modelMap, interfacesMap, unionsMap)}

    ${renderResolverFunctionInterfaces(
      type,
      args.modelMap,
      interfacesMap,
      unionsMap,
      args.context,
    )}

    ${renderResolverTypeInterface(
      type,
      args.modelMap,
      interfacesMap,
      unionsMap,
      args.context,
    )}

    ${/* TODO renderResolverClass(type, modelMap) */ ''}
  `
}

function renderUnionNamespaces(args: GenerateArgs): string {
  return args.unions.map(type => renderUnionNamespace(type, args)).join(os.EOL)
}

function renderUnionNamespace(
  graphQLTypeObject: GraphQLUnionObject,
  args: GenerateArgs,
): string {
  return `\
    export interface ${graphQLTypeObject.name}_Resolvers {
      __resolveType?: ${renderTypeResolveTypeResolver(graphQLTypeObject, args)}
    }
  `
}

function renderInputTypeInterfaces(
  type: GraphQLTypeObject,
  modelMap: ModelMap,
  interfacesMap: InterfacesMap,
  unionsMap: UnionsMap,
  typeToInputTypeAssociation: TypeToInputTypeAssociation,
  inputTypesMap: InputTypesMap,
) {
  if (!typeToInputTypeAssociation[type.name]) {
    return ``
  }

  return getDistinctInputTypes(type, typeToInputTypeAssociation, inputTypesMap)
    .map(typeAssociation => {
      return `export interface ${upperFirst(type.name)}_${upperFirst(
        inputTypesMap[typeAssociation].name,
      )} {
      ${inputTypesMap[typeAssociation].fields.map(field =>
        printFieldLikeType(field, modelMap, interfacesMap, unionsMap),
      )}
    }`
    })
    .join(os.EOL)
}

function renderInputArgInterfaces(
  type: GraphQLTypeObject,
  modelMap: ModelMap,
  interfacesMap: InterfacesMap,
  unionsMap: UnionsMap,
): string {
  return type.fields
    .map(field =>
      renderInputArgInterface(type, field, modelMap, interfacesMap, unionsMap),
    )
    .join(os.EOL)
}

function renderInputArgInterface(
  type: GraphQLTypeObject,
  field: GraphQLTypeField,
  modelMap: ModelMap,
  interfacesMap: InterfacesMap,
  unionsMap: UnionsMap,
): string {
  if (field.arguments.length === 0) {
    return ''
  }

  return `
  export interface ${getInputArgName(type, field)} {
    ${field.arguments
      .map(arg =>
        printFieldLikeType(
          arg as GraphQLTypeField,
          modelMap,
          interfacesMap,
          unionsMap,
        ).replace(': ', `: ${getArgTypePrefix(type, arg)}`),
      )
      .join(',' + os.EOL)}
  }
  `
}

const getArgTypePrefix = (
  type: GraphQLTypeObject,
  fieldArg: GraphQLTypeArgument,
): string => {
  if (
    fieldArg.type.isScalar ||
    // Object type includes GQL ID
    fieldArg.type.isObject ||
    fieldArg.type.isEnum
  )
    return ''
  return upperFirst(type.name) + '_'
}

function renderResolverFunctionInterfaces(
  type: GraphQLTypeObject,
  modelMap: ModelMap,
  interfacesMap: InterfacesMap,
  unionsMap: UnionsMap,
  context?: ContextDefinition,
): string {
  return type.fields
    .map(field =>
      renderResolverFunctionInterface(
        field,
        type,
        modelMap,
        interfacesMap,
        unionsMap,
        context,
      ),
    )
    .join(os.EOL)
}

function renderResolverFunctionInterface(
  field: GraphQLTypeField,
  type: GraphQLTypeObject,
  modelMap: ModelMap,
  interfacesMap: InterfacesMap,
  unionsMap: UnionsMap,
  context?: ContextDefinition,
): string {
  const resolverName = `${upperFirst(type.name)}_${upperFirst(
    field.name,
  )}_Resolver`
  const resolverDefinition = `
  (
    parent: ${getModelName(type.type as any, modelMap)},
    args: ${field.arguments.length > 0 ? getInputArgName(type, field) : '{}'},
    ctx: ${getContextName(context)},
    info: GraphQLResolveInfo,
  )
  `

  const returnType = printFieldLikeType(
    field,
    modelMap,
    interfacesMap,
    unionsMap,
    {
      isReturn: true,
    },
  )

  if (type.name === 'Subscription') {
    return `
    export type ${resolverName} = {|
      subscribe: ${resolverDefinition} => AsyncIterator<${returnType}> | Promise<AsyncIterator<${returnType}>>,
      resolve?: ${resolverDefinition} => ${resolverReturnType(returnType)}
    |}
    `
  }

  return `
  export type ${resolverName} = ${resolverDefinition} => ${resolverReturnType(
    returnType,
  )}
  `
}

function renderResolverTypeInterface(
  type: GraphQLTypeObject,
  modelMap: ModelMap,
  interfacesMap: InterfacesMap,
  unionsMap: UnionsMap,
  context?: ContextDefinition,
): string {
  return `
  export interface ${upperFirst(type.name)}_Resolvers {
    ${type.fields
      .map(field =>
        renderResolverTypeInterfaceFunction(
          field,
          type,
          modelMap,
          interfacesMap,
          unionsMap,
          context,
        ),
      )
      .join(os.EOL)}
  }
  `
}

function renderResolverTypeInterfaceFunction(
  field: GraphQLTypeField,
  type: GraphQLTypeObject,
  modelMap: ModelMap,
  interfacesMap: InterfacesMap,
  unionsMap: UnionsMap,
  context?: ContextDefinition,
): string {
  const resolverDefinition = `
  (
    parent: ${getModelName(type.type as any, modelMap)},
    args: ${field.arguments.length > 0 ? getInputArgName(type, field) : '{}'},
    ctx: ${getContextName(context)},
    info: GraphQLResolveInfo,
  )`
  const returnType = printFieldLikeType(
    field,
    modelMap,
    interfacesMap,
    unionsMap,
    {
      isReturn: true,
    },
  )

  if (type.name === 'Subscription') {
    return `
    ${field.name}: {|
      subscribe: ${resolverDefinition} => AsyncIterator<${returnType}> | Promise<AsyncIterator<${returnType}>>,
      resolve?: ${resolverDefinition} => ${resolverReturnType(returnType)}
    |}
    `
  }
  return `
  ${field.name}: ${resolverDefinition} => ${resolverReturnType(returnType)},
  `
}

function renderResolvers(args: GenerateArgs): string {
  return `
export interface Resolvers {
  ${[
    ...args.types
      .filter(type => type.type.isObject)
      .map(type => `${type.name}: ${upperFirst(type.name)}_Resolvers`),
    ...args.interfaces.map(
      type => `${type.name}?: ${upperFirst(type.name)}_Resolvers`,
    ),
    ...args.unions.map(
      type => `${type.name}?: ${upperFirst(type.name)}_Resolvers`,
    ),
  ].join(`,${os.EOL}`)}
}
  `
}

function getInputArgName(type: GraphQLTypeObject, field: GraphQLTypeField) {
  return `${upperFirst(type.name)}_Args_${upperFirst(field.name)}`
}
