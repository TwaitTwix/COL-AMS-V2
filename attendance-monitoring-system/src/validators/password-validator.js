import { z } from 'zod';
import { strongPassword,PASSWORD_HELP } from '../../public/js/password-policy.js';
export const passwordSchema=z.string().refine(strongPassword,PASSWORD_HELP);
