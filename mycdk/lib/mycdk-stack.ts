import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

import * as ecr from 'aws-cdk-lib/aws-ecr';

import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';

import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Duration } from 'aws-cdk-lib';

import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

import * as codecommit from 'aws-cdk-lib/aws-codecommit';


import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfront_origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';




export class MycdkStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "workshop-vpc", {

      ipAddresses: ec2.IpAddresses.cidr('10.1.0.0/16'),
      natGateways: 1,
      subnetConfiguration: [
        { cidrMask: 24, subnetType: ec2.SubnetType.PUBLIC, name: "Public" },
        { cidrMask: 24, subnetType: ec2.SubnetType.PRIVATE_ISOLATED, name: "Private" }
      ],
      maxAzs: 3 // Default is all AZs in region
    });

    //bastion Security Group
    const bastionSecurityGroup = new ec2.SecurityGroup(this, 'BastionSecurityGroup', {
      vpc: vpc,
      allowAllOutbound: true,
      description: 'Security group for bastion host',
      securityGroupName: 'BastionSecurityGroup'
    });

    bastionSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'SSH access');


    //rds Sec Group
    // const intrnalTraffic = new ec2.SecurityGroup(this, 'internalTraffic', {
    //   vpc: vpc,
    //   securityGroupName: 'InternalTraffic',
    //   description: 'Internal VPC traffic',
    // });

    // intrnalTraffic.addIngressRule(ec2.Peer.securityGroupId(intrnalTraffic.securityGroupId), ec2.Port.allTraffic(), 'Internal Traffic rule');
    // intrnalTraffic.addEgressRule(ec2.Peer.securityGroupId(intrnalTraffic.securityGroupId), ec2.Port.allTraffic(), 'Internal Traffic rule');

    const intrnalTraffic = new ec2.SecurityGroup(this, 'internalTraffic', {
      vpc: vpc,
      securityGroupName: 'InternalTraffic',
      description: 'Internal VPC traffic',
      disableInlineRules: true,
    });

    const intrnalTrafficId = intrnalTraffic.securityGroupId

    //May have to run later
    intrnalTraffic.addIngressRule(ec2.Peer.securityGroupId(intrnalTrafficId), ec2.Port.allTraffic(), 'Internal Traffic rule');
    intrnalTraffic.addEgressRule(ec2.Peer.securityGroupId(intrnalTrafficId), ec2.Port.allTraffic(), 'Internal Traffic rule');

    //New key pair
    // const keyPair = new ec2.KeyPair(this, 'KeyPair', {
    //   keyPairName: 'bastionkey',
    //   type: ec2.KeyPairType.RSA,
    // })

    const bastionHostLinux = new ec2.BastionHostLinux(this, 'BastionHostLinux', {
      vpc: vpc,
      securityGroup: bastionSecurityGroup,
      subnetSelection: {
        subnetType: ec2.SubnetType.PUBLIC
      },

    });
    bastionHostLinux.instance.instance.addPropertyOverride('KeyName', 'myBastionkey');
    // bastionHostLinux.instance.instance.keyName = 'bastionkey';



    const profile = this.node.tryGetContext('profile');

    const createSshKeyCommand = 'ssh-keygen -t rsa -f my_rsa_key';
    const pushSshKeyCommand = `aws ec2-instance-connect send-ssh-public-key --region ${cdk.Aws.REGION} --instance-id ${bastionHostLinux.instanceId} --availability-zone ${bastionHostLinux.instanceAvailabilityZone} --instance-os-user ec2-user --ssh-public-key file://my_rsa_key.pub ${profile ? `--profile ${profile}` : ''}`;
    const sshCommand = `ssh -o "IdentitiesOnly=yes" -i my_rsa_key ec2-user@${bastionHostLinux.instancePublicDnsName}`;

    new cdk.CfnOutput(this, 'CreateSshKeyCommand', { value: createSshKeyCommand });
    new cdk.CfnOutput(this, 'PushSshKeyCommand', { value: pushSshKeyCommand });
    new cdk.CfnOutput(this, 'SshCommand', { value: sshCommand });

    // create a security group for aurora db
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc: vpc, // use the vpc created above
      allowAllOutbound: true, // allow outbound traffic to anywhere
    })

    // allow inbound traffic from anywhere to the db
    dbSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432), // allow inbound traffic on port 5432 (postgres)
      'allow inbound traffic from anywhere to the db on port 5432'
    )

    const dbsecret = new rds.DatabaseSecret(this, 'AuroraSecret', {
      username: 'myadmin',
      secretName: 'mydbSecret',
    });
    // create a db cluster

    const dbCluster = new rds.DatabaseCluster(this, 'DbCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_13_10,
      }),
      instances: 1,
      credentials: rds.Credentials.fromSecret(dbsecret),
      defaultDatabaseName: 'demos',
      instanceProps: {
        vpc: vpc,
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
        autoMinorVersionUpgrade: true,
        publiclyAccessible: false,
        securityGroups: [bastionSecurityGroup,dbSecurityGroup],
        vpcSubnets: vpc.selectSubnets({
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        }),
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    // add capacity to the db cluster to enable scaling
    cdk.Aspects.of(dbCluster).add({
      visit(node) {
        if (node instanceof rds.CfnDBCluster) {
          node.serverlessV2ScalingConfiguration = {
            minCapacity: 0.5, // min capacity is 0.5 vCPU
            maxCapacity: 1, // max capacity is 1 vCPU (default)
          }
        }
      },
    })
    dbCluster.connections.allowDefaultPortFrom(bastionSecurityGroup, 'Allow access from bastion host');




    const repository = new ecr.Repository(this, "workshop-api", {
      repositoryName: "workshop-api"
    });






    const cluster = new ecs.Cluster(this, "MyCluster", {
      vpc: vpc
    });

    const executionRolePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ]
    });

    const fargateTaskDefinition = new ecs.FargateTaskDefinition(this, 'ApiTaskDefinition', {
      memoryLimitMiB: 512,
      cpu: 256,
    });
    fargateTaskDefinition.addToExecutionRolePolicy(executionRolePolicy);
    fargateTaskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'rds:DescribeDBInstances',
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret',
      ],
      resources: ['*'],
    }));

    // const secret = new secretsmanager.Secret(this, 'DbCredentials', {
    //   secretName: 'db-credentials',
    //   generateSecretString: {
    //     secretStringTemplate: JSON.stringify({ username: 'dbadmin' }),
    //     generateStringKey: 'password',
    //     excludeCharacters: '"@/\\',
    //   },
    // });


    const container = fargateTaskDefinition.addContainer("backend", {
      // Use an image from Amazon ECR
      image: ecs.ContainerImage.fromRegistry(repository.repositoryUri),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'workshop-api' }),
      environment: {
        'DATABASE_HOST': dbCluster.clusterEndpoint.hostname,
        'DATABASE_PORT': '5432',
        'DATABASE_NAME': 'demos',
      },
      secrets:
      {
        'DATABASE_USER': ecs.Secret.fromSecretsManager(dbsecret, 'username'),
        'DATABASE_PASSWORD': ecs.Secret.fromSecretsManager(dbsecret, 'password'),
      }


    });

    container.addPortMappings({
      containerPort: 8000
    });

    //adding policy to retrieve secret
    container.addToExecutionPolicy(
      new iam.PolicyStatement(
        {
          actions: ["ecr:GetAuthorizationToken", "ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage", "logs:CreateLogStream", "logs:PutLogEvents"],
          effect: iam.Effect.ALLOW,
          resources: [repository.repositoryArn],
        }
      )
    );


    container.addToExecutionPolicy(
      new iam.PolicyStatement(
        {
          actions: [
            "secretsmanager:GetResourcePolicy",
            "secretsmanager:GetSecretValue",
            "secretsmanager:DescribeSecret",
            "secretsmanager:ListSecrets",
            "kms:Decrypt"],
          effect: iam.Effect.ALLOW,
          resources: [dbsecret.secretArn],
        }
      )
    );



    const sg_service = new ec2.SecurityGroup(this, 'MySGService', { vpc: vpc });
    sg_service.addIngressRule(ec2.Peer.ipv4('0.0.0.0/0'), ec2.Port.tcp(8000));
    sg_service.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8000));

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: fargateTaskDefinition,
      enableExecuteCommand: true,
      desiredCount: 2,
      assignPublicIp: true,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      securityGroups: [sg_service, intrnalTraffic]

    });


    // Setup AutoScaling policy
    const scaling = service.autoScaleTaskCount({ maxCapacity: 6, minCapacity: 2 });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 50,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60)
    });

    const lb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true
    });

    const listener = lb.addListener('Listener', {
      port: 80,
    });

    listener.addTargets('Target', {
      port: 80,
      targets: [service],
      healthCheck: { path: '/', healthyHttpCodes: '200-302' },
    });

    listener.connections.allowDefaultPortFromAnyIpv4('Open to the world');








    // Optionally, create an S3 bucket for CloudFront logging
    // const bucket = new s3.Bucket(this, 'MyCloudFrontLogs', {
    //   removalPolicy: cdk.RemovalPolicy.DESTROY,
    //   autoDeleteObjects: true,
    // });

    // Create CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'MyDistribution', {
      defaultBehavior: {
        origin: new cloudfront_origins.LoadBalancerV2Origin(lb, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      // logBucket: bucket,
      logIncludesCookies: true,
    });

    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: distribution.distributionDomainName,
    });



  }
}
