export const first = (list: any[]) => list[0];
export const rest = (list: any[]) => list.slice(1);
export const last = (list: any[]) => list[list.length - 1];
export const butLast = (list: any[]) => list.slice(0, list.length - 1);