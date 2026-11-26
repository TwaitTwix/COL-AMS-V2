import { supabase } from '../config/supabase.js';

const failure=(status,message)=>Object.assign(new Error(message),{status});
export async function validateAcademicSelection({institution,college,course},{requireCourse=false}={}){
  if(!institution&&!college&&!course&&!requireCourse)return;
  if(!institution||!college)throw failure(400,'Choose an institution and one of its colleges');
  const {data:parent,error:parentError}=await supabase.from('colleges').select('name').eq('institution',institution).eq('name',college).eq('active',true).maybeSingle();
  if(parentError)throw failure(503,'Unable to validate the academic catalog');
  if(!parent)throw failure(400,'This college does not belong to the selected institution');
  if(!course){if(requireCourse)throw failure(400,'Choose a course for the selected college');return;}
  const {data:program,error}=await supabase.from('courses').select('name').eq('institution',institution).eq('college',college).eq('name',course).eq('active',true).maybeSingle();
  if(error)throw failure(503,'Unable to validate the course catalog');
  if(!program)throw failure(400,'This course does not belong to the selected institution and college');
}
