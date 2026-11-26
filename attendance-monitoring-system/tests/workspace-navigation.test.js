import test from 'node:test';
import assert from 'node:assert/strict';
import {operationalMenu,requestedWorkspacePage} from '../public/js/workspace-navigation.js';
import {eventScheduleState} from '../public/js/operational-dashboard.js';
const access=(role,keys)=>({enabled:true,role,features:keys.map(key=>({key,effective:true,available:true}))});
test('workspace menus follow operational priority, hide unavailable/revoked features and keep Audit Trail last',()=>{
 const a=access('administrator',['events.view','attendance.review','rosters.view','accounts.manage','reports.view','audit.view']);
 assert.deepEqual(operationalMenu(a).map(([key])=>key),['dashboard','events','reviews','classes','students','reports','roles','audit']);
 a.features.find(f=>f.key==='reports.view').available=false;assert.equal(operationalMenu(a).some(([key])=>key==='reports'),false);
 a.features.find(f=>f.key==='audit.view').effective=false;assert.equal(operationalMenu(a).some(([key])=>key==='audit'),false);
 assert.deepEqual(operationalMenu(access('classroom_representative',['events.view','attendance.review','rosters.manage','audit.view'])).map(([key])=>key),['dashboard','events','reviews','classes','audit']);
 assert.deepEqual(operationalMenu({...a,enabled:false}),[]);assert.deepEqual(operationalMenu({...a,role:'student'}),[]);
});
test('refresh/back restoration selects only accessible workspace pages and preserves account settings',()=>{
 const a=access('club_president',['events.view','rosters.view']);
 assert.equal(requestedWorkspacePage('/','?view=classes',a),'classes');assert.equal(requestedWorkspacePage('/account','',a),'account');
 for(const query of ['?view=roles','?view=audit','?view=unknown','?view=%3Cscript%3E'])assert.equal(requestedWorkspacePage('/',query,a),'dashboard');
 assert.equal(requestedWorkspacePage('/account','',{...a,enabled:false}),'dashboard');
});
test('dashboard schedule labels respect one-hour opening and half-open event boundaries',()=>{
 const e={starts_at:'2026-11-26T09:00:00Z',ends_at:'2026-11-26T12:00:00Z'},at=s=>Date.parse('2026-11-26T'+s+'Z');
 assert.equal(eventScheduleState(e,at('07:59:59')),'upcoming');assert.equal(eventScheduleState(e,at('08:00:00')),'opening');assert.equal(eventScheduleState(e,at('09:00:00')),'ongoing');assert.equal(eventScheduleState(e,at('12:00:00')),'ended');assert.equal(eventScheduleState({...e,starts_at:'invalid'}),'unknown');
});
