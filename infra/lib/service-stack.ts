import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

export interface ServiceStackProps extends cdk.StackProps {
	vpc: ec2.Vpc;
	certificateArn?: string;
	domainName?: string;
}

export class ServiceStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props: ServiceStackProps) {
		super(scope, id, props);

		const { vpc, certificateArn, domainName } = props;

		// ── ECR Repository ────────────────────────────────────────────────
		const repository = new ecr.Repository(this, "Repository", {
			repositoryName: "cyrus",
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			lifecycleRules: [
				{
					maxImageCount: 10,
					description: "Keep last 10 images",
				},
			],
		});

		// ── Secrets Manager ───────────────────────────────────────────────
		const secrets = new secretsmanager.Secret(this, "Secrets", {
			secretName: "cyrus/config",
			description: "Cyrus application secrets",
			generateSecretString: {
				secretStringTemplate: JSON.stringify({
					LINEAR_CLIENT_ID: "CHANGE_ME",
					LINEAR_CLIENT_SECRET: "CHANGE_ME",
					LINEAR_WEBHOOK_SECRET: "CHANGE_ME",
					ANTHROPIC_API_KEY: "CHANGE_ME",
				}),
				generateStringKey: "_placeholder",
			},
		});

		// ── EFS File System ───────────────────────────────────────────────
		const fileSystem = new efs.FileSystem(this, "FileSystem", {
			vpc,
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
			encrypted: true,
			performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
			throughputMode: efs.ThroughputMode.ELASTIC,
			removalPolicy: cdk.RemovalPolicy.RETAIN,
		});

		const accessPoint = fileSystem.addAccessPoint("DataAccessPoint", {
			path: "/cyrus-data",
			posixUser: { uid: "1000", gid: "1000" },
			createAcl: { ownerUid: "1000", ownerGid: "1000", permissions: "755" },
		});

		// ── ECS Cluster ───────────────────────────────────────────────────
		const cluster = new ecs.Cluster(this, "Cluster", {
			vpc,
			clusterName: "cyrus",
			containerInsightsV2: ecs.ContainerInsights.ENHANCED,
		});

		// ── Fargate Task Definition ───────────────────────────────────────
		const taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDef", {
			cpu: 2048,
			memoryLimitMiB: 4096,
			runtimePlatform: {
				cpuArchitecture: ecs.CpuArchitecture.X86_64,
				operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
			},
		});

		// EFS volume
		taskDefinition.addVolume({
			name: "cyrus-data",
			efsVolumeConfiguration: {
				fileSystemId: fileSystem.fileSystemId,
				transitEncryption: "ENABLED",
				authorizationConfig: {
					accessPointId: accessPoint.accessPointId,
					iam: "ENABLED",
				},
			},
		});

		// Grant EFS access to the task role
		fileSystem.grantRootAccess(taskDefinition.taskRole);
		taskDefinition.taskRole.addToPrincipalPolicy(
			new iam.PolicyStatement({
				actions: [
					"elasticfilesystem:ClientMount",
					"elasticfilesystem:ClientWrite",
				],
				resources: [fileSystem.fileSystemArn],
			}),
		);

		// ── Container Definition ──────────────────────────────────────────
		const container = taskDefinition.addContainer("cyrus", {
			image: ecs.ContainerImage.fromEcrRepository(repository, "latest"),
			logging: ecs.LogDrivers.awsLogs({
				streamPrefix: "cyrus",
				logRetention: logs.RetentionDays.TWO_WEEKS,
			}),
			environment: {
				NODE_ENV: "production",
				CYRUS_HOST_EXTERNAL: "true",
				CYRUS_SERVER_PORT: "3456",
			},
			secrets: {
				LINEAR_CLIENT_ID: ecs.Secret.fromSecretsManager(
					secrets,
					"LINEAR_CLIENT_ID",
				),
				LINEAR_CLIENT_SECRET: ecs.Secret.fromSecretsManager(
					secrets,
					"LINEAR_CLIENT_SECRET",
				),
				LINEAR_WEBHOOK_SECRET: ecs.Secret.fromSecretsManager(
					secrets,
					"LINEAR_WEBHOOK_SECRET",
				),
				ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(
					secrets,
					"ANTHROPIC_API_KEY",
				),
			},
			portMappings: [{ containerPort: 3456, protocol: ecs.Protocol.TCP }],
			healthCheck: {
				command: [
					"CMD-SHELL",
					"curl -f http://localhost:3456/status || exit 1",
				],
				interval: cdk.Duration.seconds(30),
				timeout: cdk.Duration.seconds(5),
				retries: 3,
				startPeriod: cdk.Duration.seconds(60),
			},
		});

		container.addMountPoints({
			containerPath: "/home/cyrus/.cyrus",
			sourceVolume: "cyrus-data",
			readOnly: false,
		});

		// ── Fargate Service ───────────────────────────────────────────────
		const service = new ecs.FargateService(this, "Service", {
			cluster,
			taskDefinition,
			desiredCount: 1,
			vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
			enableExecuteCommand: true,
			circuitBreaker: { rollback: true },
			assignPublicIp: false,
		});

		// Allow Fargate tasks to reach EFS
		service.connections.allowTo(fileSystem, ec2.Port.tcp(2049), "EFS access");

		// ── Application Load Balancer ─────────────────────────────────────
		const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
			vpc,
			internetFacing: true,
			vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
		});

		// HTTP listener (always created)
		const httpListener = alb.addListener("HttpListener", {
			port: 80,
			protocol: elbv2.ApplicationProtocol.HTTP,
		});

		// If a certificate ARN is provided, add HTTPS and redirect HTTP → HTTPS
		if (certificateArn) {
			const certificate = acm.Certificate.fromCertificateArn(
				this,
				"Certificate",
				certificateArn,
			);

			const httpsListener = alb.addListener("HttpsListener", {
				port: 443,
				protocol: elbv2.ApplicationProtocol.HTTPS,
				certificates: [certificate],
			});

			httpsListener.addTargets("HttpsTarget", {
				port: 3456,
				protocol: elbv2.ApplicationProtocol.HTTP,
				targets: [service],
				healthCheck: {
					path: "/status",
					interval: cdk.Duration.seconds(30),
					healthyThresholdCount: 2,
					unhealthyThresholdCount: 3,
				},
			});

			// Redirect HTTP → HTTPS
			httpListener.addAction("HttpRedirect", {
				action: elbv2.ListenerAction.redirect({
					protocol: "HTTPS",
					port: "443",
					permanent: true,
				}),
			});
		} else {
			// No certificate — route HTTP directly to the service
			httpListener.addTargets("HttpTarget", {
				port: 3456,
				protocol: elbv2.ApplicationProtocol.HTTP,
				targets: [service],
				healthCheck: {
					path: "/status",
					interval: cdk.Duration.seconds(30),
					healthyThresholdCount: 2,
					unhealthyThresholdCount: 3,
				},
			});
		}

		// ── Outputs ───────────────────────────────────────────────────────
		new cdk.CfnOutput(this, "AlbDnsName", {
			value: alb.loadBalancerDnsName,
			description: "ALB DNS name for Linear webhook URL",
		});

		new cdk.CfnOutput(this, "WebhookUrl", {
			value:
				certificateArn && domainName
					? `https://${domainName}/webhook`
					: `http://${alb.loadBalancerDnsName}/webhook`,
			description: "Webhook URL to configure in Linear",
		});

		new cdk.CfnOutput(this, "EcrRepositoryUri", {
			value: repository.repositoryUri,
			description: "ECR repository URI for docker push",
		});

		new cdk.CfnOutput(this, "SecretsArn", {
			value: secrets.secretArn,
			description: "Secrets Manager ARN (update with real values)",
		});

		new cdk.CfnOutput(this, "FileSystemId", {
			value: fileSystem.fileSystemId,
			description: "EFS file system ID",
		});
	}
}
