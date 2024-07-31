import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as sqs from 'aws-cdk-lib/aws-sqs';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // // VPC
    // const vpc = new ec2.Vpc(this, 'TheVPC', {
    //   cidr: "10.0.0.0/16"
    // })

    // // RDS 
    // const dbInstance = new rds.DatabaseInstance(this, 'MyRdsInstance', {
    //   engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_5_7 }),
    //   instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE2, ec2.InstanceSize.MICRO),
    //   vpc,
    //   multiAz: false,
    //   allocatedStorage: 20,
    //   maxAllocatedStorage: 100,
    //   deletionProtection: false,
    //   deleteAutomatedBackups: true
    // });

    // // ECS Cluster
    // const cluster = new ecs.Cluster(this, 'MyCluster', {
    //   vpc
    // });

    // // Fargate 
    // new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'MyFargateService', {
    //   cluster,
    //   taskImageOptions: {
    //     image: ecs.ContainerImage.fromRegistry('amazon/amazon-ecs-sample')
    //   },
    //   publicLoadBalancer: true
    // });

    // example resource
    const queue = new sqs.Queue(this, 'CdkQueue', {
      visibilityTimeout: cdk.Duration.seconds(300)
    });
  }
}
