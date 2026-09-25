#!/usr/bin/env node
// Registers grid-view.js as a Lovelace resource and adds the Alexa music player
// card to a dashboard, through the Home Assistant websocket API (Node 22+).
//
//   HA_URL=https://example.ui.nabu.casa HA_TOKEN=... node scripts/install-to-ha.mjs --list
//   HA_URL=... HA_TOKEN=... node scripts/install-to-ha.mjs --resource <url> [--dashboard <url_path>] [--view <path|index>] [--dry-run]
//
// The dashboard's previous config is written to ha-backup-<dashboard>.json before saving.
import { writeFileSync } from 'fs';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const { HA_URL, HA_TOKEN } = process.env;
if (!HA_URL || !HA_TOKEN) {
  console.error('HA_URL and HA_TOKEN must be set');
  process.exit(1);
}

const CARD = { type: 'custom:alexa-music-player-card', title: 'Music' };

const ws = new WebSocket(`${HA_URL.replace(/^http/, 'ws').replace(/\/$/, '')}/api/websocket`);
let nextId = 1;
const pending = new Map();

const send = (type, data = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`No reply to ${type} after 30s`));
    }, 30000);
    pending.set(id, {
      resolve: result => (clearTimeout(timer), resolve(result)),
      reject: err => (clearTimeout(timer), reject(err)),
    });
    ws.send(JSON.stringify({ id, type, ...data }));
  });

const authenticated = new Promise((resolve, reject) => {
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: HA_TOKEN }));
    else if (msg.type === 'auth_ok') resolve();
    else if (msg.type === 'auth_invalid') reject(new Error(`Authentication failed: ${msg.message}`));
    else if (msg.type === 'result' && pending.has(msg.id)) {
      const { resolve: ok, reject: fail } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.success) ok(msg.result);
      else fail(new Error(`${msg.error.code}: ${msg.error.message}`));
    }
  });
  ws.addEventListener('error', () => reject(new Error(`Could not connect to ${HA_URL}`)));
});

const main = async () => {
  await authenticated;

  if (flag('--list')) {
    const dashboards = await send('lovelace/dashboards/list');
    console.log('Dashboards (use url_path with --dashboard; omit it for the default "Overview"):');
    for (const d of dashboards) console.log(`  ${d.url_path}\t${d.title}\t(${d.mode})`);
    const resources = await send('lovelace/resources');
    console.log('Resources:');
    for (const r of resources) console.log(`  ${r.id}\t${r.res_type}\t${r.url}`);
    const players = (await send('get_states')).filter(s => s.entity_id.startsWith('media_player.'));
    console.log('Media players:');
    for (const p of players) console.log(`  ${p.entity_id}\t${p.attributes.friendly_name || ''}\t${p.state}`);
    return;
  }

  const resourceUrl = option('--resource');
  if (!resourceUrl) throw new Error('--resource <url> is required');
  const dashboard = option('--dashboard') || null;
  const viewOption = option('--view') || '0';
  const dryRun = flag('--dry-run');

  // Look up the dashboard and view first so a typo changes nothing
  const config = await send('lovelace/config', { url_path: dashboard, force: false });
  // --view takes the view's path (the last part of its URL) or its index
  const views = config.views || [];
  let viewIndex = views.findIndex(v => v.path === viewOption);
  if (viewIndex === -1 && /^\d+$/.test(viewOption)) viewIndex = Number(viewOption);
  const view = views[viewIndex];
  if (!view) throw new Error(`Dashboard has no view "${viewOption}"`);

  // Resource: update an existing grid-view.js entry, or create one
  const resources = await send('lovelace/resources');
  const existing = resources.find(r => r.url.includes('grid-view.js'));
  if (existing?.url === resourceUrl) console.log('Resource already registered');
  else if (dryRun) console.log(`[dry-run] would ${existing ? 'update' : 'create'} resource ${resourceUrl}`);
  else if (existing) {
    await send('lovelace/resources/update', { resource_id: existing.id, res_type: 'module', url: resourceUrl });
    console.log(`Updated resource ${existing.url} -> ${resourceUrl}`);
  } else {
    await send('lovelace/resources/create', { res_type: 'module', url: resourceUrl });
    console.log(`Created resource ${resourceUrl}`);
  }

  // Card: append to the chosen view unless it is already on the dashboard
  if (JSON.stringify(config).includes(CARD.type)) {
    console.log('Card already on the dashboard');
    return;
  }

  const updated = structuredClone(config);
  const target = updated.views[viewIndex];
  if (target.type === 'sections') {
    target.sections = target.sections || [];
    target.sections.push({ type: 'grid', cards: [CARD] });
  } else {
    target.cards = target.cards || [];
    target.cards.push(CARD);
  }

  if (dryRun) {
    console.log(`[dry-run] would add card to view "${view.title || view.path || viewIndex}"`);
    return;
  }
  const backup = `ha-backup-${dashboard || 'lovelace'}.json`;
  writeFileSync(backup, JSON.stringify(config, null, 2));
  await send('lovelace/config/save', { url_path: dashboard, config: updated });
  console.log(`Added card to view "${view.title || view.path || viewIndex}" (backup: ${backup})`);
};

main()
  .catch(err => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => ws.close());
