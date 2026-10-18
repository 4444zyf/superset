import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";
import {Database} from "bun:sqlite";
const require=createRequire('/workspace/superset/packages/host-service/package.json');
const {drizzle}=require('drizzle-orm/bun-sqlite'),{migrate}=require('drizzle-orm/bun-sqlite/migrator');
const source='/workspace/superset/packages/host-service/drizzle';
const folder=mkdtempSync(join(tmpdir(),'agent-catalog-migration-'));mkdirSync(join(folder,'meta'));
const journal=JSON.parse(readFileSync(join(source,'meta/_journal.json'),'utf8'));journal.entries=journal.entries.filter((e:any)=>e.idx<38);
writeFileSync(join(folder,'meta/_journal.json'),JSON.stringify(journal));
for(const entry of journal.entries)copyFileSync(join(source,entry.tag+'.sql'),join(folder,entry.tag+'.sql'));
const sqlite=new Database(':memory:');const db=drizzle(sqlite);
try{
 migrate(db,{migrationsFolder:folder});
 sqlite.run("INSERT INTO host_settings (id,worktree_base_dir,branch_prefix_mode,branch_prefix_custom,default_codex_home) VALUES (1, '/owned/worktrees', 'custom', 'owned-', '/owned/vendor-profile')");
 const before=sqlite.query('SELECT * FROM host_settings WHERE id=1').get();
 migrate(db,{migrationsFolder:source});
 assert.deepEqual(sqlite.query('SELECT * FROM host_settings WHERE id=1').get(),{...before,agent_catalog_initialized:0});
 sqlite.run('UPDATE host_settings SET agent_catalog_initialized=1 WHERE id=1');
 migrate(db,{migrationsFolder:source});
 assert.deepEqual(sqlite.query('SELECT * FROM host_settings WHERE id=1').get(),{...before,agent_catalog_initialized:1});
 console.log('SQLite migration 0037 -> 0038: existing settings preserved, false default applied, initialized choice survives rerun.');
}finally{sqlite.close();rmSync(folder,{recursive:true,force:true});}
