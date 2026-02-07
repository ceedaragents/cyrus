export interface TeamTask {
	id: string;
	subject: string;
	description: string;
	activeForm: string;
	blockedBy: string[];
	assignTo?: string;
	subroutineName: string;
}
