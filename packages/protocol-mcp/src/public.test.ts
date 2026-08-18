import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME, parseMcpStandalonePresetFlag } from './public.js';

describe('public', () => {
  it('exports PACKAGE_NAME', () => {
    expect(PACKAGE_NAME).toBe('@kotowari/protocol-mcp');
  });

  it('defaults standalone MCP to personal and accepts explicit presets', () => {
    expect(parseMcpStandalonePresetFlag([])).toBe('personal');
    expect(parseMcpStandalonePresetFlag(['--preset', 'readonly'])).toBe('readonly');
    expect(parseMcpStandalonePresetFlag(['--preset', 'advanced'])).toBe('advanced');
  });

  it('rejects unknown standalone MCP presets', () => {
    expect(() => parseMcpStandalonePresetFlag(['--preset', 'retrieve'])).toThrow(
      'Unknown MCP standalone preset: retrieve',
    );
  });

  it('rejects enterprise profile flags rather than silently broadening local authority', () => {
    expect(() => parseMcpStandalonePresetFlag(['--profile', 'retrieve'])).toThrow(
      'Standalone MCP uses --preset; enterprise profiles are HTTP endpoints',
    );
  });
});
