import activity from "bootstrap-icons/icons/activity.svg?raw";
import alarm from "bootstrap-icons/icons/alarm.svg?raw";
import arrowCounterclockwise from "bootstrap-icons/icons/arrow-counterclockwise.svg?raw";
import arrowDown from "bootstrap-icons/icons/arrow-down.svg?raw";
import arrowLeft from "bootstrap-icons/icons/arrow-left.svg?raw";
import arrowRight from "bootstrap-icons/icons/arrow-right.svg?raw";
import bell from "bootstrap-icons/icons/bell.svg?raw";
import bellSlash from "bootstrap-icons/icons/bell-slash.svg?raw";
import boxArrowUpRight from "bootstrap-icons/icons/box-arrow-up-right.svg?raw";
import checkCircle from "bootstrap-icons/icons/check-circle.svg?raw";
import chevronDoubleUp from "bootstrap-icons/icons/chevron-double-up.svg?raw";
import chevronDown from "bootstrap-icons/icons/chevron-down.svg?raw";
import clipboardData from "bootstrap-icons/icons/clipboard-data.svg?raw";
import clockHistory from "bootstrap-icons/icons/clock-history.svg?raw";
import clock from "bootstrap-icons/icons/clock.svg?raw";
import codeSlash from "bootstrap-icons/icons/code-slash.svg?raw";
import dashLg from "bootstrap-icons/icons/dash-lg.svg?raw";
import exclamationCircle from "bootstrap-icons/icons/exclamation-circle.svg?raw";
import filter from "bootstrap-icons/icons/filter.svg?raw";
import gear from "bootstrap-icons/icons/gear.svg?raw";
import grid1x2 from "bootstrap-icons/icons/grid-1x2.svg?raw";
import hourglassBottom from "bootstrap-icons/icons/hourglass-bottom.svg?raw";
import listUl from "bootstrap-icons/icons/list-ul.svg?raw";
import people from "bootstrap-icons/icons/people.svg?raw";
import pinAngleFill from "bootstrap-icons/icons/pin-angle-fill.svg?raw";
import pinAngle from "bootstrap-icons/icons/pin-angle.svg?raw";
import plusCircle from "bootstrap-icons/icons/plus-circle.svg?raw";
import reception1 from "bootstrap-icons/icons/reception-1.svg?raw";
import search from "bootstrap-icons/icons/search.svg?raw";
import shieldExclamation from "bootstrap-icons/icons/shield-exclamation.svg?raw";
import stopwatch from "bootstrap-icons/icons/stopwatch.svg?raw";
import upload from "bootstrap-icons/icons/upload.svg?raw";
import xLg from "bootstrap-icons/icons/x-lg.svg?raw";

const icons = {
  activity,
  alarm,
  "arrow-counterclockwise": arrowCounterclockwise,
  "arrow-down": arrowDown,
  "arrow-left": arrowLeft,
  "arrow-right": arrowRight,
  bell,
  "bell-slash": bellSlash,
  "box-arrow-up-right": boxArrowUpRight,
  "check-circle": checkCircle,
  "chevron-double-up": chevronDoubleUp,
  "chevron-down": chevronDown,
  "clipboard-data": clipboardData,
  clock,
  "clock-history": clockHistory,
  "code-slash": codeSlash,
  "dash-lg": dashLg,
  "exclamation-circle": exclamationCircle,
  filter,
  gear,
  "grid-1x2": grid1x2,
  "hourglass-bottom": hourglassBottom,
  "list-ul": listUl,
  people,
  "pin-angle": pinAngle,
  "pin-angle-fill": pinAngleFill,
  "plus-circle": plusCircle,
  "reception-1": reception1,
  search,
  "shield-exclamation": shieldExclamation,
  stopwatch,
  upload,
  "x-lg": xLg,
};

export type IconName = keyof typeof icons;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const source = icons[name];
  // The SVG files come from Bootstrap Icons. Keep their paths and set dimensions on the root here.
  const paths = source.slice(source.indexOf(">") + 1, source.lastIndexOf("</svg>"));
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      dangerouslySetInnerHTML={{ __html: paths }}
    />
  );
}
