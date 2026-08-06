import nextConfig from 'eslint-config-next';
import eslintConfigPrettier from 'eslint-config-prettier';
import base from './base.mjs';

export default [...base, ...nextConfig, eslintConfigPrettier];
