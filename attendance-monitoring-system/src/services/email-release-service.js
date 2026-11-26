// Auth and the application database are separate transactions. Retirement is
// marked first to block old tokens; retries finish a partially completed job.
export async function releaseArchivedEmail(input,{rpc,admin}){
  const begun=await rpc('begin_archived_email_release',{p_actor:input.actor,p_student:input.student,p_user:input.user,p_email:input.email,p_reason:input.reason});
  if(begun.error)throw Object.assign(new Error(begun.error.code==='P0001'?begun.error.message:'Unable to prepare email release'),{status:begun.error.code==='P0001'?409:503});
  if(begun.data.completed)return {completed:true};
  const existing=await admin.getUserById(begun.data.user_id);
  if(existing.error&&existing.error.status!==404)throw Object.assign(new Error('Unable to verify the old login. It remains blocked. Retry Release email.'),{status:503});
  if(!existing.data?.user?.deleted_at&&existing.error?.status!==404){
    const retired=await admin.deleteUser(begun.data.user_id,true);
    if(retired.error&&retired.error.status!==404)throw Object.assign(new Error('Email release is unfinished. The old account is blocked. Retry Release email to complete it.'),{status:503});
  }
  const finished=await rpc('finish_archived_email_release',{p_actor:input.actor,p_user:begun.data.user_id,p_auth_retired:true});
  if(finished.error)throw Object.assign(new Error('Email release is unfinished. Retry Release email to complete it.'),{status:503});
  return finished.data;
}
