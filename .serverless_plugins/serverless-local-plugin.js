'use strict';
const BbPromise = require('bluebird');


class ServerlessLocalPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.hooks = {
      'before:package:finalize': this.finalize.bind(this),
      'package:createDeploymentArtifacts': this.beforeDeploy.bind(this)
    };
  }
  beforeDeploy() {
    return BbPromise.bind(this)
        .then(() => this.addLogRetention());
  }
  finalize() {
    return BbPromise.bind(this)
        .then(() => this.modifyLambdaFunctions())
        .then(() => this.ddEnableToggle());
  }
  addLogRetention() {
    const template = this.serverless.service.provider.compiledCloudFormationTemplate;
    for (const resource in template.Resources) {
      if (template.Resources[resource].Type === 'AWS::Logs::LogGroup') {
        let logRetentionInDays =  this.serverless.service.custom.logRetentionInDays;
        template.Resources[resource].Properties.RetentionInDays = {
          'Fn::If': [
            'UseDataDog',
            logRetentionInDays,
            {
              Ref: 'AWS::NoValue'
            }
          ]
        };
      }
    }
  }

  renameDdServiceEnv (environment, functionName) {
    if ('Variables' in environment && 'DD_SERVICE' in environment.Variables) {
      environment.Variables.DD_SERVICE = functionName;
    }
  }
  modifyFunctionS3Key(properties) {
    if ('Code' in properties) {
      let s3Key = properties.Code.S3Key;
      let packageName = s3Key.substr(s3Key.lastIndexOf('/') + 1) 
      properties.Code.S3Key = { 
        'Fn::Sub' : `\${PackageArtifactsPath}/${packageName}`
      }
    }
  }
  ddEnableToggle() { 
    const template = this.serverless.service.provider.compiledCloudFormationTemplate;
    for (const resource in template.Resources) {
      if (template.Resources[resource].Type === 'AWS::Logs::SubscriptionFilter') {
        template.Resources[resource].Condition = 'UseDataDog';
      }
      if (template.Resources[resource].Type === 'AWS::Lambda::Function') {
        if ('Environment' in template.Resources[resource].Properties) {
          let environment = template.Resources[resource].Properties.Environment;
          if ('Variables' in environment && 'DD_LAMBDA_HANDLER' in environment.Variables) {
            let handler = environment.Variables.DD_LAMBDA_HANDLER;
            template.Resources[resource].Properties.Handler = {
              'Fn::If': [
                'UseDataDog',
                "datadog_lambda.handler.handler",
                handler
              ]
            };
          }
        }
        if ('Layers' in template.Resources[resource].Properties) {
          let currentLayers = template.Resources[resource].Properties.Layers;
          let notDdLayers = currentLayers.filter(function (layer) {
            return layer.indexOf('Datadog') === -1;
          })
          let ddLayers = currentLayers.filter(function (layer) {
            return layer.indexOf('Datadog') != -1;
          })
          let finalLayers = [...notDdLayers];
          for (const ddlayer in ddLayers) {
            finalLayers.push({
              'Fn::If': [
                'UseDataDog',
                template.Resources[resource].Properties.Layers[ddlayer],
                {
                  Ref: 'AWS::NoValue'
                }
              ]
            });
          }
          template.Resources[resource].Properties.Layers = finalLayers;
        }
      }
    }
  }
  modifyLambdaFunctions() {
    const template = this.serverless.service.provider.compiledCloudFormationTemplate;
    for (const resource in template.Resources) {
      if (template.Resources[resource].Type === 'AWS::Lambda::Function') {
        if ('Environment' in template.Resources[resource].Properties) {
          let functionName = template.Resources[resource].Properties.FunctionName;
          this.renameDdServiceEnv(template.Resources[resource].Properties.Environment, functionName)
        }
        this.modifyFunctionS3Key(template.Resources[resource].Properties)
      }
    }
  }
}

module.exports = ServerlessLocalPlugin;
