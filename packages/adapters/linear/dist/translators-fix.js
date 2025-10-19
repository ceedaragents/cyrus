// Map status to Linear state names
if (update.status) {
	const stateMap = {
		active: "In Progress",
		paused: "Paused",
		completed: "Done",
		failed: "Canceled",
		cancelled: "Canceled",
	};
	const stateName = stateMap[update.status];
	if (stateName) {
		result.stateUpdate = { name: stateName };
	}
}
//# sourceMappingURL=translators-fix.js.map
