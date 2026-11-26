const labels={student:'Student',student_officer:'Student Officer',col_officer:'COL Officer',officer:'Officer',admin:'Administrator',main_admin:'Main Administrator',pending:'Pending'};
export function reportRole(row,profilesByUser,profilesByStudent){
  // Never substitute the staff recorder's role for the attendee's role, or a
  // newly linked account for an explicitly recorded account that is missing.
  const profile=row.user_id?profilesByUser.get(row.user_id):profilesByStudent.get(row.student_id);
  if(!profile)return row.user_id?'Account unavailable':'No linked account';
  return labels[profile.role]||'Unknown role';
}
