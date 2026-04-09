import initSqlJs from 'sql.js'
import { assetPath } from './assetPath'

let _db: import('sql.js').Database | null = null

export async function getDb() {
  if (_db) return _db
  const SQL = await initSqlJs({ locateFile: () => assetPath('wasm/sql-wasm.wasm') })
  const buf = await fetch(assetPath('pokehousing.sqlite')).then((r) => r.arrayBuffer())
  _db = new SQL.Database(new Uint8Array(buf))
  return _db
}
