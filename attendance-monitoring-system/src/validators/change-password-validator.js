import { z } from 'zod';
import { passwordSchema } from './password-validator.js';
export const changePasswordSchema=z.object({current_password:z.string().min(1).max(128),password:passwordSchema,confirm_password:z.string()}).refine(value=>value.password===value.confirm_password,{path:['confirm_password'],message:'Passwords do not match'}).refine(value=>value.password!==value.current_password,{path:['password'],message:'Choose a password different from your current password'});
