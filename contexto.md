3. Casper Agentic Buildathon ⭐ (Prioridad 1)
dorahacks.io/hackathon/casper-agentic-buildathon

Estado: $150,000 en premios. x402 Facilitator patrocinado (transacciones on-chain gratis para probar micropagos). AI Toolkit. Casper = primera L1 WebAssembly-native con x402 en vivo; contratos en Rust/Wasm.

Reglas clave / tracks: Agentic AI, DeFi & Payments, Cross-Chain, RWA Tokenization. La narrativa del sponsor: agentes que transaccionan como actores económicos y construyen apps autónomamente en mainnet.

Proyecto ganador — "SIGIL": el servidor MCP que da a cualquier agente memoria + secretos + micropagos x402 en Casper Porta SIGIL a Casper: un servidor MCP que expone, como herramientas, (a) lectura/escritura verificable de memoria del agente, (b) Grimoire para secretos/políticas, y (c) pagos x402 nativos. Cualquier agente lo enchufa y de inmediato puede pagar por servicios y recordar lo que hizo.

El ángulo que nadie tomará: todos van a hacer "un agente que hace X". Tú entregas la herramienta que hace posibles a todos los demás agentes — exactamente el mensaje de Casper ("agents as economic actors"). Es meta, es infra, y es lo más difícil de copiar porque ya tienes SIGIL y Grimoire.

Qué construir (programable):

Contrato Rust/Wasm en Casper testnet para anclar hashes de memoria del agente.
Integración x402 para que el agente pague micro-servicios (free vía Facilitator).
Grimoire-on-Casper: bóveda de secretos/políticas de gasto.
Servidor MCP que expone todo + un agente demo que usa x402 para comprarse datos y registra cada paso.

Stack: Rust + Casper SDK/Wasm, x402 Facilitator, AI Toolkit de Casper, tu servidor MCP, Claude como agente.

Estilo visual: identidad "grimorio + máquina": tablero con el "libro de hechizos" (tools MCP disponibles), flujo de un pago x402 animado, log verificable. Dark, dorado/violeta.

Cómo cumple/maximiza: golpea Agentic AI (núcleo) y DeFi & Payments (x402) simultáneamente; usa el AI Toolkit y x402 (lo que el sponsor quiere ver); y posiciona tu proyecto como infraestructura del ecosistema → fuerte para grants post-hackathon. Tu mejor apuesta absoluta.




Los docs base:

- Casper docs: https://docs.casper.network/
- Prerequisites: https://docs.casper.network/developers/prerequisites
- Rust contracts getting started: https://docs.casper.network/developers/writing-onchain-code/getting-started
- Basic smart contract: https://docs.casper.network/developers/writing-onchain-code/simple-contract
- Testing contracts: https://docs.casper.network/developers/writing-onchain-code/testing-contracts
- Sending transactions: https://docs.casper.network/developers/cli/sending-transactions
- Counter testnet tutorial: https://docs.casper.network/resources/beginner/counter-testnet/overview
- Faucet: https://testnet.cspr.live/tools/faucet
- Testnet explorer: https://testnet.cspr.live/

Repos clave:

- casper-node: https://github.com/casper-network/casper-node
- casper-client-rs: https://github.com/casper-ecosystem/casper-client-rs
- cargo-casper: https://github.com/casper-ecosystem/cargo-casper
- casper-js-sdk: https://github.com/casper-ecosystem/casper-js-sdk
- casper-x402: https://github.com/make-software/casper-x402
