export interface TeamTask {
	id: string;
	subject: string;
	description: string;
	activeForm: string;
	blockedBy: string[];
	assignTo?: string;
	subroutineName: string;
}

export interface ComplexityScore {
	score: number;
	useTeam: boolean;
	reasoning: string;
	suggestedTeamSize: number;
}

export interface ComplexityInput {
	classification: string;
	issueTitle: string;
	issueDescription: string;
	procedureName: string;
	labels?: string[];
}
