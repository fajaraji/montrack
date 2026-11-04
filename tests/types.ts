export type * from "../src/shared/types";
export interface ChecklistLike {
  dismissed: boolean;
  items: { id: string; done: boolean }[];
}
