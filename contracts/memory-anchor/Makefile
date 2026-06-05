prepare:
	rustup target add wasm32-unknown-unknown

build-contract:
	cargo build --release --target wasm32-unknown-unknown

test: build-contract
	@echo "No Casper engine integration test crate is present yet; build-contract is the current contract verification target."
