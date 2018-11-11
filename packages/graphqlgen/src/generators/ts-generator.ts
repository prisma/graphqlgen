import * as os from 'os'
import * as prettier from 'prettier'

import { GenerateArgs, ModelMap, ContextDefinition } from '../types'
import {
  GraphQLTypeField,
  GraphQLTypeObject,
  GraphQLInterfaceObject,
  GraphQLTypeDefinition,
  GraphQLUnionObject,
} from '../source-helper'
import {
  renderDefaultResolvers,
  getContextName,
  getModelName,
  TypeToInputTypeAssociation,
  InputTypesMap,
  printFieldLikeType,
  getDistinctInputTypes,
  renderEnums,
  groupModelsNameByImportPath,
  InterfacesMap,
  UnionsMap,
} from './common'
import { TypeAliasDefinition } from '../introspection/types'
import { upperFirst, flatten } from '../utils'

export function format(code: string, options: prettier.Options = {}) {
  try {
    return prettier.format(code, {
      ...options,
      parser: 'typescript',
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

  const interfacesMap: InterfacesMap = args.interfaces.reduce(
    (interfaces, int) => {
      return {
        ...interfaces,
        [int.name]: int.types,
      }
    },
    {},
  )

  const unionsMap: InterfacesMap = args.unions.reduce((interfaces, int) => {
    return {
      ...interfaces,
      [int.name]: int.types,
    }
  }, {})

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
  const modelsToImport = Object.keys(args.modelMap)
    .filter(modelName => {
      const modelDef = args.modelMap[modelName].definition

      return !(
        modelDef.kind === 'TypeAliasDefinition' &&
        (modelDef as TypeAliasDefinition).isEnum
      )
    })
    .map(modelName => args.modelMap[modelName])
  const modelsByImportPaths = groupModelsNameByImportPath(modelsToImport)

  const modelImports = Object.keys(modelsByImportPaths)
    .map(
      importPath =>
        `import { ${modelsByImportPaths[importPath].join(
          ', ',
        )} } from '${importPath}'`,
    )
    .join(os.EOL)

  return `
// Code generated by github.com/prisma/graphqlgen, DO NOT EDIT.

import { GraphQLResolveInfo, GraphQLTypeResolver, GraphQLIsTypeOfFn } from 'graphql'
${modelImports}
${renderContext(args.context)}
  `
}

function renderContext(context?: ContextDefinition) {
  if (context) {
    return `import { ${getContextName(context)} } from '${context.contextPath}'`
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
  return `\
    ${renderObjectNamespaces(
      args,
      interfacesMap,
      unionsMap,
      typeToInputTypeAssociation,
      inputTypesMap,
    )}

    ${renderInterfaceNamespaces(args, interfacesMap, unionsMap)}

    ${renderUnionNamespaces(args)}
  `
}

function renderObjectNamespaces(
  args: GenerateArgs,
  interfacesMap: InterfacesMap,
  unionsMap: UnionsMap,
  typeToInputTypeAssociation: TypeToInputTypeAssociation,
  inputTypesMap: InputTypesMap,
): string {
  return args.types
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
}

function renderInterfaceNamespaces(
  args: GenerateArgs,
  interfacesMap: InterfacesMap,
  unionsMap: UnionsMap,
): string {
  return args.interfaces
    .map(type => renderInterfaceNamespace(type, interfacesMap, unionsMap, args))
    .join(os.EOL)
}

function renderUnionNamespaces(args: GenerateArgs): string {
  return args.unions.map(type => renderUnionNamespace(type, args)).join(os.EOL)
}

function renderInterfaceNamespace(
  graphQLTypeObject: GraphQLInterfaceObject,
  interfacesMap: InterfacesMap,
  unionsMap: UnionsMap,
  args: GenerateArgs,
): string {
  return `\
    export namespace ${graphQLTypeObject.name}Resolvers {
      ${renderInputArgInterfaces(
        graphQLTypeObject,
        args.modelMap,
        interfacesMap,
        unionsMap,
      )}

      ${renderResolverTypeInterface(
        graphQLTypeObject,
        args.modelMap,
        interfacesMap,
        unionsMap,
        args.context,
        'InterfaceType',
      )}

      export interface Type {
        __resolveType: GraphQLTypeResolver<${graphQLTypeObject.types
          .map(interfaceType => getModelName(interfaceType, args.modelMap))
          .join(' | ')}, ${getContextName(args.context)}>;
      }
    }
  `
}

function renderUnionNamespace(
  graphQLTypeObject: GraphQLUnionObject,
  args: GenerateArgs,
): string {
  return `\
    export namespace ${graphQLTypeObject.name}Resolvers {
      export interface Type {
        __resolveType?: GraphQLTypeResolver<${graphQLTypeObject.types
          .map(interfaceType => getModelName(interfaceType, args.modelMap))
          .join(' | ')}, ${getContextName(args.context)}>;
      }
    }
  `
}

function renderNamespace(
  graphQLTypeObject: GraphQLTypeObject,
  interfacesMap: InterfacesMap,
  unionsMap: UnionsMap,
  typeToInputTypeAssociation: TypeToInputTypeAssociation,
  inputTypesMap: InputTypesMap,
  args: GenerateArgs,
): string {
  return `\
    export namespace ${graphQLTypeObject.name}Resolvers {

    ${renderDefaultResolvers(graphQLTypeObject, args, 'defaultResolvers')}

    ${renderInputTypeInterfaces(
      graphQLTypeObject,
      args.modelMap,
      interfacesMap,
      unionsMap,
      typeToInputTypeAssociation,
      inputTypesMap,
    )}

    ${renderInputArgInterfaces(
      graphQLTypeObject,
      args.modelMap,
      interfacesMap,
      unionsMap,
    )}

    ${renderResolverFunctionInterfaces(
      graphQLTypeObject,
      args.modelMap,
      interfacesMap,
      unionsMap,
      args.context,
    )}

    ${renderResolverTypeInterface(
      graphQLTypeObject,
      args.modelMap,
      interfacesMap,
      unionsMap,
      args.context,
    )}

    ${/* TODO renderResolverClass(type, modelMap) */ ''}
  }
  `
}

function renderIsTypeOfFunctionInterface(
  type: GraphQLTypeObject,
  modelMap: ModelMap,
  interfacesMap: InterfacesMap,
  unionsMap: UnionsMap,
  context?: ContextDefinition,
) {
  let possibleTypes: GraphQLTypeDefinition[] = []

  if (type.interfaces) {
    possibleTypes = type.interfaces.reduce(
      (obj: GraphQLTypeDefinition[], interfaceName) => {
        return flatten(obj, interfacesMap[interfaceName])
      },
      [],
    )
  }

  for (let unionName in unionsMap) {
    if (unionsMap[unionName].find(unionType => unionType.name === type.name)) {
      possibleTypes = unionsMap[unionName]
    }
  }

  if (possibleTypes.length === 0) {
    return ''
  }
  return `\
    __isTypeOf?: GraphQLIsTypeOfFn<${possibleTypes
      .map(possibleType => getModelName(possibleType, modelMap))
      .join(' | ')}, ${getContextName(context)}>;`
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
      return `export interface ${inputTypesMap[typeAssociation].name} {
      ${inputTypesMap[typeAssociation].fields.map(
        field =>
          `${field.name}: ${printFieldLikeType(
            field,
            modelMap,
            interfacesMap,
            unionsMap,
          )}`,
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
      renderInputArgInterface(field, modelMap, interfacesMap, unionsMap),
    )
    .join(os.EOL)
}

function renderInputArgInterface(
  field: GraphQLTypeField,
  modelMap: ModelMap,
  interfacesMap: InterfacesMap,
  unionsMap: UnionsMap,
): string {
  if (field.arguments.length === 0) {
    return ''
  }

  return `
  export interface Args${upperFirst(field.name)} {
    ${field.arguments
      .map(
        arg =>
          `${arg.name}: ${printFieldLikeType(
            arg as GraphQLTypeField,
            modelMap,
            interfacesMap,
            unionsMap,
          )}`,
      )
      .join(os.EOL)}
  }
  `
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
  const resolverName = `${upperFirst(field.name)}Resolver`
  const resolverDefinition = `
  (
    parent: ${getModelName(type.type as any, modelMap, 'undefined')},
    args: ${
      field.arguments.length > 0 ? `Args${upperFirst(field.name)}` : '{}'
    },
    ctx: ${getContextName(context)},
    info: GraphQLResolveInfo,
  )
  `
  const returnType = printFieldLikeType(
    field,
    modelMap,
    interfacesMap,
    unionsMap,
  )

  if (type.name === 'Subscription') {
    return `
    export type ${resolverName} = {
      subscribe: ${resolverDefinition} => AsyncIterator<${returnType}> | Promise<AsyncIterator<${returnType}>>
      resolve?: ${resolverDefinition} => ${returnType} | Promise<${returnType}>
    }
    `
  }

  return `
  export type ${resolverName} = ${resolverDefinition} => ${returnType} | Promise<${returnType}>
  `
}

function renderResolverTypeInterface(
  type: GraphQLTypeObject,
  modelMap: ModelMap,
  interfacesMap: InterfacesMap,
  unionsMap: UnionsMap,
  context?: ContextDefinition,
  interfaceName: string = 'Type',
): string {
  const extend =
    type.interfaces && type.interfaces.length
      ? `extends ${type.interfaces
          .map(typeInterface => `${typeInterface}Resolvers.InterfaceType`)
          .join(',')}`
      : ''

  return `
  export interface ${interfaceName} ${extend} {
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
      ${renderIsTypeOfFunctionInterface(
        type,
        modelMap,
        interfacesMap,
        unionsMap,
        context,
      )}
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
  let parent: string

  if (type.type.isInterface) {
    const implementingTypes = interfacesMap[type.name]

    parent = implementingTypes
      .map(implType => getModelName(implType, modelMap, 'undefined'))
      .join(' | ')
  } else {
    parent = getModelName(type.type as any, modelMap, 'undefined')
  }

  const resolverDefinition = `
  (
    parent: ${parent},
    args: ${
      field.arguments.length > 0 ? `Args${upperFirst(field.name)}` : '{}'
    },
    ctx: ${getContextName(context)},
    info: GraphQLResolveInfo,
  )
  `
  const returnType = printFieldLikeType(
    field,
    modelMap,
    interfacesMap,
    unionsMap,
  )

  if (type.name === 'Subscription') {
    return `
    ${field.name}: {
      subscribe: ${resolverDefinition} => AsyncIterator<${returnType}> | Promise<AsyncIterator<${returnType}>>
      resolve?: ${resolverDefinition} => ${returnType} | Promise<${returnType}>
    }
    `
  }

  return `
    ${
      field.name
    }: ${resolverDefinition} => ${returnType} | Promise<${returnType}>
  `
}

function renderResolvers(args: GenerateArgs): string {
  return `\
export interface Resolvers {
  ${[
    ...args.types
      .filter(obj => obj.type.isObject)
      .map(type => `${type.name}: ${type.name}Resolvers.Type`),
    ...args.interfaces.map(type => `${type.name}?: ${type.name}Resolvers.Type`),
    ...args.unions.map(type => `${type.name}?: ${type.name}Resolvers.Type`),
  ].join(os.EOL)}
}
  `
}
