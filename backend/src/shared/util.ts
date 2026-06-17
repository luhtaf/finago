import { nanoid } from 'nanoid';

/** ID pendek dengan prefix opsional, mis. newId('pgj') -> 'pgj_V1StGXR8_Z5j'. */
export const newId = (prefix = ''): string => (prefix ? `${prefix}_` : '') + nanoid(12);
