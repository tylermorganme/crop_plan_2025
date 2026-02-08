Before we implement this feature, scan the codebase and show me how similar functionality is already handled. Look for patterns in layout files, existing components, and any README or docs.

Break this into parallel workstreams: 1) Create a TodoWrite plan identifying which files can be modified independently. 2) For each independent component group, use Task to spawn an agent that handles just that group. 3) Have each agent complete its work fully before I review. Coordinate to avoid editing the same files. Start with the dependency analysis now.
