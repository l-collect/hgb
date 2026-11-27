import type { ReactNode } from "react";

/** The admin's line icons, 24-unit paths drawn in the text colour (UI v8: icons carry no colour of their own). */
const line = (size: number, width: number, d: ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

export const KeyIcon = ({ size = 20 }: { size?: number }) => line(size, 1.75, <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3" /></>);
export const UserIcon = ({ size = 20 }: { size?: number }) => line(size, 1.75, <><circle cx="12" cy="8" r="4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>);
export const BackIcon = ({ size = 16 }: { size?: number }) => line(size, 2, <path d="m15 6-6 6 6 6" />);
export const NextIcon = ({ size = 18 }: { size?: number }) => line(size, 2, <path d="m9 6 6 6-6 6" />);
export const DownIcon = ({ size = 16 }: { size?: number }) => line(size, 1.75, <path d="m6 9 6 6 6-6" />);
export const PlusIcon = ({ size = 18 }: { size?: number }) => line(size, 2, <path d="M12 5v14M5 12h14" />);
export const DownloadIcon = ({ size = 18 }: { size?: number }) => line(size, 1.75, <path d="M12 4v10M8 10l4 4 4-4M5 19h14" />);
export const SearchIcon = ({ size = 18 }: { size?: number }) => line(size, 1.75, <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const CloseIcon = ({ size = 18 }: { size?: number }) => line(size, 2, <path d="M6 6l12 12M18 6 6 18" />);
export const AlertIcon = ({ size = 18 }: { size?: number }) => line(size, 2, <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></>);
