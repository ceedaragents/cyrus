#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ServiceStack } from "../lib/service-stack";
import { VpcStack } from "../lib/vpc-stack";

const app = new cdk.App();

const env: cdk.Environment = {
	account: process.env.CDK_DEFAULT_ACCOUNT,
	region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

const vpcStack = new VpcStack(app, "CyrusVpc", { env });

new ServiceStack(app, "CyrusService", {
	env,
	vpc: vpcStack.vpc,
	certificateArn: app.node.tryGetContext("certificateArn"),
	domainName: app.node.tryGetContext("domainName"),
	baseUrl: app.node.tryGetContext("baseUrl"),
});
