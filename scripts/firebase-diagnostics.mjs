// Read-only probes: match the queries actually used by listing and recovery.
export async function checkFirebaseQueries(store) {
  const now=new Date().toISOString();
  const probes=[
    ['trip-list','trips',{where:[['ownerId','==','__diagnostic_no_user__']],orderBy:'updatedAt',limit:1}],
    ['queued-jobs','jobs',{where:[['state','==','queued']],limit:1}],
    ['expired-jobs','jobs',{where:[['state','==','running'],['leaseUntil','<',now]],orderBy:'leaseUntil',desc:false,limit:1}],
    ['expired-mail','mailJobs',{where:[['status','==','sending'],['leaseUntil','<',now]],orderBy:'leaseUntil',desc:false,limit:1}]
  ];
  const checks=[];
  for(const [check,collection,options] of probes) {
    try{await store.query(collection,options);checks.push({check,ok:true});}
    catch(e){checks.push({check,ok:false,code:e.code===9&&/requires an index/i.test(e.message)?'FIRESTORE_INDEX_REQUIRED':'FIREBASE_QUERY_FAILED'});}
  }
  return {ready:checks.every(c=>c.ok),checks};
}
