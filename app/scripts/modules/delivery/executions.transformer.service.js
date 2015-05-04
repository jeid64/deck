'use strict';

angular.module('deckApp.delivery.executionTransformer.service', [
  'deckApp.orchestratedItem.service',
  'deckApp.utils.lodash',
  'deckApp.pipelines.config',
])
  .factory('executionsTransformer', function(orchestratedItem, _, pipelineConfig) {

    function transformExecution(execution) {
      pipelineConfig.getExecutionTransformers().forEach(function(transformer) {
        transformer.transform(execution);
      });
      var stageSummaries = [];

      execution.stages.forEach(function(stage, index) {
        stage.before = stage.before || [];
        stage.after = stage.after || [];
        stage.index = index;
        orchestratedItem.defineProperties(stage);
        if (stage.tasks && stage.tasks.length) {
          stage.tasks.forEach(orchestratedItem.defineProperties);
        }
      });

      execution.stages.forEach(function(stage) {
        var owner = stage.syntheticStageOwner;
        var parent = _.find(execution.stages, { id: stage.parentStageId });
        if (parent) {
          if (owner === 'STAGE_BEFORE') {
            parent.before.push(stage);
          }
          if (owner === 'STAGE_AFTER') {
            parent.after.push(stage);
          }
        }
      });

      execution.stages.forEach(function(stage) {
        if (!stage.syntheticStageOwner) {
          stageSummaries.push({
            name: stage.name,
            id: stage.id,
            masterStage: stage,
            type: stage.type,
            before: stage.before,
            after: stage.after,
            status: stage.status
          });
        }
      });

      orchestratedItem.defineProperties(execution);

      stageSummaries.forEach(transformStageSummary);
      execution.stageSummaries = stageSummaries;
      execution.currentStages = getCurrentStages(execution);

    }

    function flattenStages(stages, stage) {
      if (stage.before && stage.before.length) {
        stage.before.forEach(function(beforeStage) {
          stages = flattenStages(stages, beforeStage);
        });
      }
      if (stage.masterStage) {
        stages.push(stage.masterStage);
      } else {
        stages.push(stage);
      }
      if (stage.after && stage.after.length) {
        stage.after.forEach(function(afterStage) {
          stages = flattenStages(stages, afterStage);
        });
      }
      return stages;
    }

    function flattenAndFilter(stage) {
      return flattenStages([], stage).filter(function(stage) {
        return stage.type !== 'initialization' && stage.initializationStage !== true;
      });
    }

    function getCurrentStages(execution) {
      var currentStages = execution.stageSummaries.filter(function(stage) {
        return stage.isRunning;
      });
      // if there are no running stages, find the first enqueued stage
      if (!currentStages.length) {
        var enqueued = execution.stageSummaries.filter(function(stage) {
          return stage.hasNotStarted;
        });
        if (enqueued && enqueued.length) {
          currentStages = [enqueued[0]];
        }
      }
      return currentStages;
    }

    function transformStage(stage) {
      var stages = flattenAndFilter(stage);

      if (!stages.length) {
        return;
      }

      var lastStage = stages[stages.length - 1];
      stage.startTime = stages[0].startTime;

      var lastNotStartedStage = _(stages).findLast(
          function(childStage) {
            return !childStage.hasNotStarted;
          }
        );

      var lastFailedStage = _(stages).findLast(
        function(childStage) {
          return childStage.isFailed;
        }
      );

      var currentStage = lastFailedStage || lastNotStartedStage || lastStage;
      stage.status = currentStage.status;
      stage.endTime = currentStage.endTime;
      stage.stages = stages;

    }

    function transformStageSummary(summary) {
      summary.stages = flattenAndFilter(summary);
      summary.stages.forEach(transformStage);
      summary.masterStageIndex = summary.stages.indexOf(summary.masterStage);
      transformStage(summary);
      orchestratedItem.defineProperties(summary);
    }

    return {
      transformExecution: transformExecution
    };
  });
