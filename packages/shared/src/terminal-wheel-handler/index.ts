export { type CellDimensions, getCellDimensions } from "./cell-dimensions";
export {
	buildArrowSequence,
	buildSgrWheelReport,
	consumeWheelLines,
	createSgrMouseModeTracker,
	createTerminalWheelEventHandler,
	createWheelLineState,
	installTerminalWheelEventHandler,
	setTerminalBinaryInputSupported,
	type WheelLineContext,
	type WheelLineInput,
	type WheelLineState,
} from "./terminal-wheel-handler";
