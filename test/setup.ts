/**
 * Runs before every test file: the switches of a developer's or an agent's shell that change what an edit
 * does are cleared, so the tests and every CLI they spawn (which inherit this environment) see the defaults.
 * A test that wants one sets it for its own spawn.
 */
delete process.env['BPMN_KEEP_FLOW_IDS'];
