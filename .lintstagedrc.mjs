const config = {
  '*.{ts,js,mjs,cjs,json,md,yml,yaml}': ['prettier --write'],
  'feature_list.json': ['harness check'],
}

export default config
