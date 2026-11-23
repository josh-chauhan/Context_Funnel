from typing import TypedDict
from langchain_core.messages import BaseMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from typing import Annotated
from .model import model

# Keep conversation messages in the graph's state.
class ChatState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]

def call_model(state: ChatState):
    # print statement in node definition to verify invocation 
    print("LangGraph Node Invoked!")
    reply = model.invoke(state["messages"])
    return {"messages": [reply]}

# Build path of single node graph. Data flows in a dict, matching LangGraph's message handling
   # ->  execution path: START → call_model → END.
builder = StateGraph(ChatState)
builder.add_node("call_model", call_model)
builder.add_edge(START, "call_model")
builder.add_edge("call_model", END)

chat_graph = builder.compile()
