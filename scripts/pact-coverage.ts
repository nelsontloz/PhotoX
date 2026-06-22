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
  let services: string[]
  try {
    services = fs
      .readdirSync(appsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    console.error('Pact coverage: apps/ directory not found')
    process.exit(1)
  }

  function findPactSpecFiles(dir: string): string[] {
    const results: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...findPactSpecFiles(fullPath))
      } else if (entry.isFile() && entry.name.endsWith('.pact.spec.ts')) {
        results.push(fullPath)
      }
    }
    return results
  }

  const providerSpecs: string[] = []
  for (const svc of services) {
    const providerDir = path.join(appsDir, svc, 'test', 'pact', 'provider')
    if (fs.existsSync(providerDir)) {
      providerSpecs.push(...findPactSpecFiles(providerDir))
    }
  }

  if (providerSpecs.length === 0) {
    console.error('Pact coverage: no provider spec files found in apps/*/test/pact/provider/')
    process.exit(1)
  }

  const verifiedPacts = new Set<string>()
  const specPactMap = new Map<string, string[]>()

  for (const specPath of providerSpecs) {
    const content = fs.readFileSync(specPath, 'utf-8')
    const pacts = parsePactUrls(content)

    specPactMap.set(specPath, pacts)
    for (const pact of pacts) {
      verifiedPacts.add(pact)
    }
  }

  const pactSet = new Set(pactFiles)
  const unverified = pactFiles.filter((f) => !verifiedPacts.has(f))
  const orphans = [...verifiedPacts].filter((f) => !pactSet.has(f))

  console.log()
  console.log('Pact coverage')
  console.log('=============')

  let failed = false

  for (const pact of pactFiles.sort()) {
    if (verifiedPacts.has(pact)) {
      const verifyingSpecs = [...specPactMap.entries()]
        .filter(([, pacts]) => pacts.includes(pact))
        .map(([spec]) => path.basename(path.dirname(spec)) + '/' + path.basename(spec))
      console.log(`  \u2713 ${pact}  verified by ${verifyingSpecs.join(', ')}`)
    } else {
      console.log(`  \u2717 ${pact}  NO PROVIDER VERIFIES THIS`)
      failed = true
    }
  }

  for (const orphan of orphans.sort()) {
    const referringSpecs = [...specPactMap.entries()]
      .filter(([, pacts]) => pacts.includes(orphan))
      .map(([spec]) => path.basename(path.dirname(spec)) + '/' + path.basename(spec))
    console.log(
      `  \u2717 ${orphan}  referenced by ${referringSpecs.join(', ')} but not found in pacts/`,
    )
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
