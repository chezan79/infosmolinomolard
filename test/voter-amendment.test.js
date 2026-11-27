const test = require('node:test');
const assert = require('node:assert/strict');
const { mountVoterAmendment } = require('../election-engine/voter-amendment');
const { electionWindow } = require('../election-engine/contract');
const { EXPECTED } = require('../election-engine/runtime-diagnostic');
function fixture({ date='2026-11-27T12:00:00Z', employeeOverrides={}, existing=false, conflict=false, participated=false, verified=true }={}) {
  const window = electionWindow(new Date(date), 'Europe/Zurich');
  const employeeId='MOL-100';
  const employee={employeeId,siteId:'molard',active:true,canVote:true,canBeElected:false,department:'Service',votingGroup:'SERVICE',displayName:'Test Voter',...employeeOverrides};
  const original={employeeId:'MOL-200',votingGroup:'SERVICE',verifier:conflict?'new-verifier':'old-verifier',verifierVersion:1};
  const election={...window,siteId:'molard',dataEnvironment:'production',timeZone:'Europe/Zurich',voters:{'MOL-200':original},candidates:{'MOL-300':{employeeId:'MOL-300'}},eligibleVoterCount:1};
  if(existing){election.voters[employeeId]={employeeId};election.eligibleVoterCount++;}
  const writes=[];let refreshes=0;let handler;
  const ref={collection:name=>({doc:id=>({name,id})})};
  const db={projectId:verified?EXPECTED.firebaseAdminProjectId:'wrong',databaseId:'(default)',
    collection:()=>({doc:()=>({collection:()=>({doc:()=>({collection:()=>({doc:()=>ref})})})})}),
    runTransaction:async fn=>fn({get:async r=>r===ref?{exists:true,data:()=>election}:{exists:participated},
      update:(r,data)=>writes.push({op:'update',r,data}),create:(r,data)=>writes.push({op:'create',r,data})})};
  const env={NODE_ENV:'production',EMPLOYEE_DIRECTORY_SITE_ID:'molard',ELECTION_DATA_ENVIRONMENT:'production',ELECTION_TIME_ZONE:'Europe/Zurich',ELECTION_RESULTS_PROJECT_ID:EXPECTED.resultsProjectId,ELECTION_RESULTS_DATABASE_ID:'(default)'};
  mountVoterAmendment({post:(_path,...handlers)=>{handler=handlers.at(-1);}}, {env,firebaseDb:db,firebaseAuth:null,
    directoryService:{refresh:async()=>{refreshes++;},getElectionSnapshot:()=>({siteId:'molard',sourceGeneration:2,employees:[employee],verifierRecords:[{employeeId,verifier:'new-verifier',verifierVersion:1}]})},now:()=>new Date(date)});
  return {writes,election,employeeId,run:async()=>{let status=200,body;const res={set(){return this;},status(n){status=n;return this;},json(x){body=x;return this;}};await handler({body:{employeeId}},res);return {status,body,refreshes};}};
}
test('voter-only amendment changes only roster/count and writes a separate audit record',async()=>{
 const f=fixture();const result=await f.run();assert.equal(result.status,200);assert.equal(result.body.code,'VOTER_ADDED');
 assert.equal(f.writes.length,2);const update=f.writes[0];assert.deepEqual(Object.keys(update.data).sort(),['eligibleVoterCount','voters']);
 assert.equal(update.data.eligibleVoterCount,2);assert.deepEqual(update.data.voters['MOL-200'],f.election.voters['MOL-200']);
 assert.equal(update.data.voters[f.employeeId].votingGroup,'SERVICE');assert.equal(f.writes[1].r.name,'rosterAmendments');
 assert.equal(f.writes[1].data.action,'ADD_VOTER_ONLY');assert.equal('verifier' in f.writes[1].data,false);
});
test('existing voter is idempotent and does not write',async()=>{const f=fixture({existing:true});assert.equal((await f.run()).body.code,'ALREADY_ELIGIBLE');assert.equal(f.writes.length,0);});
for(const [label,options,code] of [
 ['candidate',{employeeOverrides:{canBeElected:true}},'NOT_ELIGIBLE_VOTER_ONLY'],
 ['inactive',{employeeOverrides:{active:false}},'NOT_ELIGIBLE_VOTER_ONLY'],
 ['not allowed',{employeeOverrides:{canVote:false}},'NOT_ELIGIBLE_VOTER_ONLY'],
 ['duplicate verifier',{conflict:true},'IDENTITY_CONFLICT'],
 ['existing participation',{participated:true},'IDENTITY_CONFLICT'],
 ['before opening',{date:'2026-11-24T12:00:00Z'},'ELECTION_NOT_OPEN_OR_INVALID'],
 ['wrong project',{verified:false},'BINDING_UNVERIFIED']
])test('rejects '+label+' without writes',async()=>{const f=fixture(options);assert.equal((await f.run()).body.code,code);assert.equal(f.writes.length,0);});
