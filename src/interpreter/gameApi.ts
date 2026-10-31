export type SupportedCommandName =
  | 'move_right'
  | 'move_left'
  | 'move_up'
  | 'move_down'
  | 'bomb'
  | 'laser'
  | 'shockwave'
  | 'wait';

export type SupportedVariableName =
  | 'x'
  | 'y'
  | 'health'
  | 'enemy_count'
  | 'enemy_x'
  | 'enemy_y';

export interface CommandSpec {
  name: SupportedCommandName;
  arity: number;
  signature: string;
}

export const SUPPORTED_COMMANDS: Record<SupportedCommandName, CommandSpec> = {
  move_right: { name: 'move_right', arity: 0, signature: 'move_right()' },
  move_left: { name: 'move_left', arity: 0, signature: 'move_left()' },
  move_up: { name: 'move_up', arity: 0, signature: 'move_up()' },
  move_down: { name: 'move_down', arity: 0, signature: 'move_down()' },
  bomb: { name: 'bomb', arity: 2, signature: 'bomb(x, y)' },
  laser: { name: 'laser', arity: 0, signature: 'laser()' },
  shockwave: { name: 'shockwave', arity: 0, signature: 'shockwave()' },
  wait: { name: 'wait', arity: 1, signature: 'wait(ticks)' },
};

export const SUPPORTED_VARIABLES: ReadonlySet<string> = new Set<SupportedVariableName>([
  'x',
  'y',
  'health',
  'enemy_count',
  'enemy_x',
  'enemy_y',
]);

export interface CommandExecutionResult {
  success: boolean;
  formattedCall: string;
  message?: string;
  waitTicks?: number;
}

export interface IGameAPI {
  getVariable(name: SupportedVariableName): number;
  executeCommand(
    name: SupportedCommandName,
    args: number[],
    line: number
  ): Promise<CommandExecutionResult> | CommandExecutionResult;
}

