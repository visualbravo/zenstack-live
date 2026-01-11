import fs from 'node:fs/promises'

type PackageJson = {
  exports: Record<string, string | {}>
}

async function main() {
  const packageJson: PackageJson = JSON.parse(await fs.readFile('./package.json', 'utf-8'))

  packageJson.exports['./styles/globals.css'] = './src/styles/globals.css'

  await fs.writeFile('./package.json', `${JSON.stringify(packageJson, null, 2)}\n`)
}

main()
