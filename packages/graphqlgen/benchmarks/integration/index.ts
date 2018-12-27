/**
 * This module contains utility functions for creating
 * integration benchmark instances.
 */

import * as Parse from '../../src/parse'
import * as ConfigTypes from 'graphqlgen-json-schema'
import * as Validation from '../../src/validation'
import * as GGen from '../../src'
import * as Bench from 'benchmark'
import * as Path from 'path'
import * as Glob from 'glob'
import * as Util from '../../src/utils'

const collect = (): Bench[] => {
  const paths = Glob.sync(Path.join(__dirname, './*'))
  const benchmarks: Bench[] = []

  for (const path of paths) {
    if (Util.isFile(path)) continue

    const errors = validateFixtures(path)

    if (errors) {
      for (const error of errors) {
        console.log(error.message)
        process.exit(1)
      }
    }

    const modelPaths = Glob.sync(Path.join(path, './models.*'))

    for (const modelPath of modelPaths) {
      // 1. We know there will be an extension because of isFile
      // filter above. 2. We know it will be a support language extension
      // because of the filter right after.
      const ext = Util.getExt(modelPath) as Util.LanguageExtension

      if (!Util.languageExtensions.includes(ext)) continue

      const benchmark = createBenchmark({
        language: Util.getLangFromExt(ext),
        rootPath: path,
      })

      benchmarks.push(benchmark)
    }
  }

  return benchmarks
}

type Options = {
  language: ConfigTypes.GraphQLGenDefinition['language']
  rootPath: string
}

/**
 * Create a benchmark instance for testing the performance
 * of the whole GraphqlGen pipeline (except for initial
 * config parsing, file loading, and model map creation).
 */
const createBenchmark = (config: Options): Bench => {
  const codeGenConfig = createCodeGenConfig({
    language: config.language,
    rootPath: config.rootPath,
  })
  const benchmark = new Bench({
    name: `generateCode (${Path.basename(config.rootPath)} schema, ${
      config.language
    })`,
    fn: () => {
      GGen.generateCode(codeGenConfig)
    },
  })
  return benchmark
}

type CodeGenConfigOptions = {
  language: ConfigTypes.GraphQLGenDefinition['language']
  rootPath: string
}

/**
 * Create a configuration ready for consumption  by the
 * main code gen function. This utility function is needed
 * because of the current complexity of assembling the config.
 */
const createCodeGenConfig = (
  config: CodeGenConfigOptions,
): GGen.GenerateCodeArgs => {
  const sdlFilePath = Path.join(config.rootPath, 'schema.graphql')

  const schema = Parse.parseSchema(sdlFilePath)

  const models = {
    files: [Path.join(config.rootPath, './models.ts')],
  }

  const graphqlGenConfig: ConfigTypes.GraphQLGenDefinition = {
    language: config.language,
    schema: sdlFilePath,
    output: Path.join(config.rootPath, './'),
    models,
  }

  // Needed to initialize singleton data in Parse module
  Validation.validateConfig(graphqlGenConfig, schema)

  const modelMap = Parse.parseModels(
    models,
    schema,
    Path.join(config.rootPath, './'),
    graphqlGenConfig.language,
  )

  return {
    language: graphqlGenConfig.language,
    schema,
    config: graphqlGenConfig,
    modelMap,
  }
}

/**
 * Function that checks for correctness of folder/file layout of benchmarks.
 * The returned validation failure, if any, contains a message to help developers
 * fix the problem and so should be printed to them nicely.
 */
const validateFixtures = (scenarioFolder: string): null | Error[] => {
  const name = Path.basename(scenarioFolder)
  const files = Glob.sync(Path.join(scenarioFolder, './*')).map(path =>
    Path.basename(path),
  )

  const errors = []

  if (!files.includes('schema.graphql')) {
    errors.push(new Error(`benchmark "${name}" missing file schema.graphql`))
  }

  if (!files.includes('models.ts')) {
    errors.push(new Error(`benchmark "${name}" missing file models.ts`))
  }

  return errors.length ? errors : null
}

export { collect }
