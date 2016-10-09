node_modules:
	npm install

lib: node_modules package.json
	./node_modules/.bin/babel src --out-dir lib

.PHONY: test
test: lib
	ava

.PHONY: prepublish
prepublish: lib
