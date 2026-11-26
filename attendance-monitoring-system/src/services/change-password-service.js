export async function changeOwnPassword({userId,email,authorization,currentPassword,password}, {client,update}){
  try{
    const {data,error}=await client.auth.signInWithPassword({email,password:currentPassword});
    if(error){
      const unavailable=!error.status||error.status>=500;
      throw Object.assign(new Error(error.status===429?'Too many password attempts. Please wait before retrying.':unavailable?'Unable to verify your current password. Please retry.':'Current password is incorrect'),{status:error.status===429?429:unavailable?503:400});
    }
    if(data.user?.id!==userId)throw Object.assign(new Error('Unable to verify the account owner'),{status:403});
    // Keep the owner's existing token and normal Auth security checks; never
    // perform a privileged admin password reset for this self-service action.
    await update(authorization,password);
  }finally{
    // Dispose only the temporary password-verification session.
    await client.auth.signOut({scope:'local'}).catch(()=>{});
  }
}
