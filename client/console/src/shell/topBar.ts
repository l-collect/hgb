import { createContext } from "react";

/**
 * What the frame tells the page in it: whether it is one of the four primary pages (任务, 账号计划, 设备战报, 我的), whose
 * name the narrow top bar already shows, and where in that bar the page's actions go.
 */
export interface TopBar { primary: boolean; slot: HTMLElement | null }
export const TopBarContext = createContext<TopBar>({ primary: false, slot: null });
