node_modules: package.json
	npm install

.PHONY: test
test: node_modules
	ava
