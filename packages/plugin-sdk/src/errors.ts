export const PLUGIN_SDK_ERROR_CODES = ['BOUNDARY_VIOLATION', 'PORT_CONTRACT_FAILED'] as const;

export type PluginSdkErrorCode = (typeof PLUGIN_SDK_ERROR_CODES)[number];

export class PluginSdkError extends Error {
  readonly code: PluginSdkErrorCode;

  constructor(code: PluginSdkErrorCode, message: string) {
    super(message);
    this.name = 'PluginSdkError';
    this.code = code;
  }
}
