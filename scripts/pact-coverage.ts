import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const PACT_DIR = path.join(ROOT, 'pacts')

export function parsePactUrls(content: string): string[] {
  const regex = /path\.join\(\s*PACT_DIR\s*,\s*['"]([^'"]+)['"]\s*\)/g
  const matches: string[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    matches.push(match[1]!)
  }
  return matches
}

function main(): void {
  let pactFiles: string[]
  try {
    pactFiles = fs.readdirSync(PACT_DIR).filter((f) => f.endsWith('.json'))
  } catch {
    console.error('Pact coverage: pacts/ directory not found')
    process.exit(1)
  }

  if (pactFiles.length === 0) {
    console.error('Pact coverage: pacts/ is empty — no pacts to check')
    process.exit(1)
  }

  const appsDir = path.join(ROOT, 'apps')
  const providerSpecs = fs
    .readdirSync(appsDir, { recursive: true, withFileTypes: true })
    .filter(
      (d) =>
        d.isFile() &&
        d.name.endsWith('.pact.spec.ts') &&
        d.parentPath.includes(path.join('test', 'pact', 'provider')),
    )
    .map((d) => path.join(d.parentPath, d.name))

  if (providerSpecs.length === 0) {
    console.error('Pact coverage: no provider spec files found in apps/*/test/pact/provider/')
    process.exit(1)
  }

  const specPactMap = new Map<string, string[]>()
  const verifiedPacts = new Set<string>()

  for (const specPath of providerSpecs) {
    const pacts = parsePactUrls(fs.readFileSync(specPath, 'utf-8'))
    specPactMap.set(specPath, pacts)
    for (const pact of pacts) verifiedPacts.add(pact)
  }

  const pactSet = new Set(pactFiles)

  console.log()
  console.log('Pact coverage')
  console.log('=============')

  let failed = false

  for (const pact of pactFiles.sort()) {
    const specs = [...specPactMap.entries()]
      .filter(([, pacts]) => pacts.includes(pact))
      .map(([spec]) => path.basename(path.dirname(spec)) + '/' + path.basename(spec))
    if (specs.length) {
      console.log(`  \u2713 ${pact}  verified by ${specs.join(', ')}`)
    } else {
      console.log(`  \u2717 ${pact}  NO PROVIDER VERIFIES THIS`)
      failed = true
    }
  }

  for (const orphan of [...verifiedPacts].filter((f) => !pactSet.has(f)).sort()) {
    const specs = [...specPactMap.entries()]
      .filter(([, pacts]) => pacts.includes(orphan))
      .map(([spec]) => path.basename(path.dirname(spec)) + '/' + path.basename(spec))
    console.log(`  \u2717 ${orphan}  referenced by ${specs.join(', ')} but not found in pacts/`)
    failed = true
  }

  console.log()

  if (failed) {
    console.error('Pact coverage FAILED')
    process.exit(1)
  }

  console.log('Pact coverage PASSED')
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('pact-coverage.ts')) {
  main()
}
