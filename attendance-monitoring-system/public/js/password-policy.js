export const PASSWORD_HELP='Use 10–128 characters with uppercase and lowercase letters, a number, and a special character.';
export function strongPassword(value){return typeof value==='string'&&value.length>=10&&value.length<=128&&/[A-Z]/.test(value)&&/[a-z]/.test(value)&&/[0-9]/.test(value)&&/[^A-Za-z0-9\s]/.test(value);}
